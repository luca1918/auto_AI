from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import audit, banking, iban as iban_lib, idempotency
from app.db import get_db
from app.models import Account, Transaction, User
from app.money import to_minor
from app.schemas import AccountCreate, AccountOut, AmountIn, TransactionOut, TransferIn
from app.security import current_user

router = APIRouter(prefix="/api", tags=["accounts"])

MAX_ACCOUNTS_PER_USER = 10

IdempotencyKeyHeader = Header(default=None, alias="Idempotency-Key", max_length=idempotency.MAX_KEY_LENGTH,
                              description="Cheie unică per operațiune; reîncercările cu aceeași cheie nu o repetă.")


def _own_account(db: Session, user: User, account_id: int) -> Account:
    account = db.get(Account, account_id)
    if account is None or account.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cont inexistent")
    return account


def _minor(amount) -> int:
    try:
        return to_minor(amount)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc))


def _money_op(db: Session, request: Request, user: User, key: str | None, fingerprint: dict, action: str, op):
    def operation():
        try:
            tx = op()
        except banking.BankingError as exc:
            raise HTTPException(exc.status_code, exc.message)
        audit.record(db, request, action, user.id, account_id=tx.account_id, amount=tx.amount, reference=tx.reference)
        return TransactionOut.model_validate(tx)

    return idempotency.run(db, user.id, key, fingerprint, operation)


@router.get("/accounts", response_model=list[AccountOut])
def list_accounts(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(select(Account).where(Account.owner_id == user.id).order_by(Account.id)).all()


@router.post("/accounts", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
def open_account(body: AccountCreate, request: Request, user: User = Depends(current_user),
                 db: Session = Depends(get_db)):
    count = db.scalar(select(func.count()).select_from(Account).where(Account.owner_id == user.id))
    if count >= MAX_ACCOUNTS_PER_USER:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ai atins numărul maxim de conturi")
    account = Account(owner_id=user.id, iban=iban_lib.generate_ro(), name=body.name, currency=body.currency, balance=0)
    db.add(account)
    db.flush()
    audit.record(db, request, "account.opened", user.id, account_id=account.id, currency=account.currency)
    db.commit()
    return account


@router.get("/accounts/{account_id}", response_model=AccountOut)
def get_account(account_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _own_account(db, user, account_id)


@router.get("/accounts/{account_id}/transactions", response_model=list[TransactionOut])
def list_transactions(
    account_id: int,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    _own_account(db, user, account_id)
    return db.scalars(
        select(Transaction).where(Transaction.account_id == account_id)
        .order_by(Transaction.id.desc()).limit(limit).offset(offset)
    ).all()


@router.post("/accounts/{account_id}/deposit", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def deposit(account_id: int, body: AmountIn, request: Request, user: User = Depends(current_user),
            db: Session = Depends(get_db), idempotency_key: str | None = IdempotencyKeyHeader):
    account = _own_account(db, user, account_id)
    amount = _minor(body.amount)
    fingerprint = {"op": "deposit", "account_id": account_id, "amount": amount, "description": body.description}
    return _money_op(db, request, user, idempotency_key, fingerprint, "money.deposit",
                     lambda: banking.deposit(db, account, amount, body.description))


@router.post("/accounts/{account_id}/withdraw", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def withdraw(account_id: int, body: AmountIn, request: Request, user: User = Depends(current_user),
             db: Session = Depends(get_db), idempotency_key: str | None = IdempotencyKeyHeader):
    account = _own_account(db, user, account_id)
    amount = _minor(body.amount)
    fingerprint = {"op": "withdraw", "account_id": account_id, "amount": amount, "description": body.description}
    return _money_op(db, request, user, idempotency_key, fingerprint, "money.withdrawal",
                     lambda: banking.withdraw(db, account, amount, body.description))


@router.post("/transfers", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def transfer(body: TransferIn, request: Request, user: User = Depends(current_user),
             db: Session = Depends(get_db), idempotency_key: str | None = IdempotencyKeyHeader):
    account = _own_account(db, user, body.from_account_id)
    amount = _minor(body.amount)
    fingerprint = {"op": "transfer", "from": body.from_account_id, "to": iban_lib.normalize(body.to_iban),
                   "amount": amount, "description": body.description}
    return _money_op(db, request, user, idempotency_key, fingerprint, "money.transfer",
                     lambda: banking.transfer(db, account, body.to_iban, amount, body.description))
