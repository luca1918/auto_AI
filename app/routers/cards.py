from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import audit, banking, cards
from app.db import get_db
from app.models import Card, Transaction, User
from app.routers.common import IdempotencyKeyHeader, minor, money_op, own_account
from app.schemas import CardCreate, CardDetailsOut, CardOut, CardPaymentIn, CardUpdate, TransactionOut
from app.security import current_user

router = APIRouter(prefix="/api/cards", tags=["cards"])

MAX_CARDS_PER_USER = 5


def _out(db: Session, card: Card, user: User) -> CardOut:
    return CardOut.model_validate({
        "id": card.id, "account_id": card.account_id, "currency": card.account.currency, "label": card.label,
        "holder_name": user.full_name, "last4": card.last4, "expiry_month": card.expiry_month,
        "expiry_year": card.expiry_year, "frozen": card.frozen, "monthly_limit": card.monthly_limit,
        "spent_this_month": banking.card_spent_this_month(db, card.id), "created_at": card.created_at,
    })


def _own_card(db: Session, user: User, card_id: int) -> Card:
    card = db.get(Card, card_id)
    if card is None or card.owner_id != user.id or card.closed_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Card inexistent")
    return card


@router.get("", response_model=list[CardOut])
def list_cards(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Card).where(Card.owner_id == user.id, Card.closed_at.is_(None)).order_by(Card.id)).all()
    return [_out(db, c, user) for c in rows]


@router.post("", response_model=CardOut, status_code=status.HTTP_201_CREATED)
def issue_card(body: CardCreate, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    own_account(db, user, body.account_id)
    count = db.scalar(select(func.count()).select_from(Card).where(Card.owner_id == user.id, Card.closed_at.is_(None)))
    if count >= MAX_CARDS_PER_USER:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ai atins numărul maxim de carduri")
    data = cards.generate()
    card = Card(owner_id=user.id, account_id=body.account_id, label=body.label.strip(), last4=data["pan"][-4:],
                expiry_month=data["expiry_month"], expiry_year=data["expiry_year"],
                secret=cards.encrypt(data["pan"], data["cvv"]), frozen=False)
    db.add(card)
    db.flush()
    audit.record(db, request, "card.issued", user.id, card_id=card.id, account_id=card.account_id)
    db.commit()
    return _out(db, card, user)


@router.get("/{card_id}", response_model=CardOut)
def get_card(card_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(db, _own_card(db, user, card_id), user)


@router.get("/{card_id}/details", response_model=CardDetailsOut)
def card_details(card_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Full card number and CVV. Every reveal is audited."""
    card = _own_card(db, user, card_id)
    try:
        secret = cards.decrypt(card.secret)
    except cards.InvalidToken:
        raise HTTPException(status.HTTP_409_CONFLICT, "Detaliile cardului nu pot fi afișate. Emite un card nou.")
    audit.record(db, request, "card.details_viewed", user.id, card_id=card.id)
    db.commit()
    return CardDetailsOut(pan=secret["pan"], cvv=secret["cvv"], expiry_month=card.expiry_month,
                          expiry_year=card.expiry_year)


@router.patch("/{card_id}", response_model=CardOut)
def update_card(card_id: int, body: CardUpdate, request: Request, user: User = Depends(current_user),
                db: Session = Depends(get_db)):
    card = _own_card(db, user, card_id)
    if body.label is not None:
        card.label = body.label.strip()
    if body.frozen is not None and body.frozen != card.frozen:
        card.frozen = body.frozen
        audit.record(db, request, "card.frozen" if body.frozen else "card.unfrozen", user.id, card_id=card.id)
    if "monthly_limit" in body.model_fields_set:
        card.monthly_limit = minor(body.monthly_limit) if body.monthly_limit is not None else None
        audit.record(db, request, "card.limit_changed", user.id, card_id=card.id, monthly_limit=card.monthly_limit)
    db.commit()
    return _out(db, card, user)


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
def close_card(card_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    card = _own_card(db, user, card_id)
    card.closed_at = datetime.now(timezone.utc)
    audit.record(db, request, "card.closed", user.id, card_id=card.id)
    db.commit()


@router.get("/{card_id}/transactions", response_model=list[TransactionOut])
def card_transactions(card_id: int, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                      user: User = Depends(current_user), db: Session = Depends(get_db)):
    _own_card(db, user, card_id)
    return db.scalars(select(Transaction).where(Transaction.card_id == card_id)
                      .order_by(Transaction.id.desc()).limit(limit).offset(offset)).all()


@router.post("/{card_id}/payments", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def pay(card_id: int, body: CardPaymentIn, request: Request, user: User = Depends(current_user),
        db: Session = Depends(get_db), idempotency_key: str | None = IdempotencyKeyHeader):
    """Simulates a purchase at a merchant (demo stand-in for a card network authorization)."""
    card = _own_card(db, user, card_id)
    amount = minor(body.amount)
    fingerprint = {"op": "card_payment", "card": card_id, "merchant": body.merchant, "amount": amount,
                   "category": body.category}
    return money_op(db, request, user, idempotency_key, fingerprint, "card.payment",
                    lambda: banking.card_payment(db, card, body.merchant.strip(), amount, body.category),
                    TransactionOut,
                    lambda tx: {"card_id": card_id, "amount": tx.amount, "reference": tx.reference})
