import csv
import io
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import Response
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app import audit, banking, config, iban as iban_lib
from app.db import get_db
from app.models import Account, Transaction, User
from app.money import to_major, to_minor
from app.routers.common import IdempotencyKeyHeader, minor, money_op, own_account
from app.schemas import AccountCreate, AccountOut, AccountUpdate, AmountIn, TransactionOut, TransferIn
from app.security import current_user

router = APIRouter(prefix="/api", tags=["accounts"])

MAX_ACCOUNTS_PER_USER = 10


def _tx_audit(tx: Transaction) -> dict:
    return {"account_id": tx.account_id, "amount": tx.amount, "reference": tx.reference}


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
    return own_account(db, user, account_id)


@router.patch("/accounts/{account_id}", response_model=AccountOut)
def rename_account(account_id: int, body: AccountUpdate, user: User = Depends(current_user),
                   db: Session = Depends(get_db)):
    account = own_account(db, user, account_id)
    account.name = body.name.strip()
    db.commit()
    return account


@router.get("/accounts/{account_id}/transactions", response_model=list[TransactionOut])
def list_transactions(
    account_id: int,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    own_account(db, user, account_id)
    return db.scalars(
        select(Transaction).where(Transaction.account_id == account_id)
        .order_by(Transaction.id.desc()).limit(limit).offset(offset)
    ).all()


@router.get("/transactions", response_model=list[TransactionOut])
def search_transactions(
    q: str = Query("", max_length=100),
    account_id: int | None = None,
    category: str | None = Query(None, max_length=20),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Searches the customer's transactions across all accounts by text, amount and category."""
    stmt = select(Transaction).join(Account).where(Account.owner_id == user.id)
    if account_id is not None:
        stmt = stmt.where(Transaction.account_id == account_id)
    if category:
        stmt = stmt.where(Transaction.category == category)
    if q := q.strip():
        pattern = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        conditions = [Transaction.description.ilike(pattern, escape="\\"),
                      Transaction.counterparty_name.ilike(pattern, escape="\\"),
                      Transaction.counterparty_iban.ilike(pattern.replace(" ", ""), escape="\\")]
        try:
            amount = to_minor(q.replace(",", "."))
            conditions.append(Transaction.amount.in_([amount, -amount]))
        except ValueError:
            pass
        stmt = stmt.where(or_(*conditions))
    return db.scalars(stmt.order_by(Transaction.id.desc()).limit(limit).offset(offset)).all()


def _csv_cell(value: str | None) -> str:
    # Neutralizes spreadsheet formula injection from user-supplied text.
    value = value or ""
    return "'" + value if value[:1] in ("=", "+", "-", "@", "\t", "\r") else value


def _ro_amount(minor_units: int) -> str:
    return str(to_major(minor_units)).replace(".", ",")


@router.get("/accounts/{account_id}/statement.csv", response_class=Response)
def statement(
    account_id: int,
    date_from: date | None = Query(None, alias="from"),
    date_to: date | None = Query(None, alias="to"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Account statement as CSV (semicolon separated, decimal comma) for spreadsheet apps."""
    account = own_account(db, user, account_id)
    tz = ZoneInfo(config.TIMEZONE)
    stmt = select(Transaction).where(Transaction.account_id == account_id)
    if date_from:
        stmt = stmt.where(Transaction.created_at >= datetime.combine(date_from, time(), tz).astimezone(timezone.utc))
    if date_to:
        end = datetime.combine(date_to + timedelta(days=1), time(), tz).astimezone(timezone.utc)
        stmt = stmt.where(Transaction.created_at < end)

    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")
    writer.writerow(["Data", "Tip", "Descriere", "Contrapartidă", "IBAN contrapartidă", "Categorie",
                     f"Sumă ({account.currency})", f"Sold după ({account.currency})", "Referință"])
    for tx in db.scalars(stmt.order_by(Transaction.id)):
        created = tx.created_at if tx.created_at.tzinfo else tx.created_at.replace(tzinfo=timezone.utc)
        writer.writerow([created.astimezone(tz).strftime("%Y-%m-%d %H:%M"), tx.kind, _csv_cell(tx.description),
                         _csv_cell(tx.counterparty_name), tx.counterparty_iban or "", tx.category,
                         _ro_amount(tx.amount), _ro_amount(tx.balance_after), tx.reference])
    filename = f"extras-{account.iban}-{datetime.now(tz):%Y%m%d}.csv"
    return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/accounts/{account_id}/deposit", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def deposit(account_id: int, body: AmountIn, request: Request, user: User = Depends(current_user),
            db: Session = Depends(get_db), idempotency_key: str | None = IdempotencyKeyHeader):
    account = own_account(db, user, account_id)
    amount = minor(body.amount)
    fingerprint = {"op": "deposit", "account_id": account_id, "amount": amount, "description": body.description}
    return money_op(db, request, user, idempotency_key, fingerprint, "money.deposit",
                    lambda: banking.deposit(db, account, amount, body.description), TransactionOut, _tx_audit)


@router.post("/accounts/{account_id}/withdraw", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def withdraw(account_id: int, body: AmountIn, request: Request, user: User = Depends(current_user),
             db: Session = Depends(get_db), idempotency_key: str | None = IdempotencyKeyHeader):
    account = own_account(db, user, account_id)
    amount = minor(body.amount)
    fingerprint = {"op": "withdraw", "account_id": account_id, "amount": amount, "description": body.description}
    return money_op(db, request, user, idempotency_key, fingerprint, "money.withdrawal",
                    lambda: banking.withdraw(db, account, amount, body.description), TransactionOut, _tx_audit)


@router.post("/transfers", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def transfer(body: TransferIn, request: Request, user: User = Depends(current_user),
             db: Session = Depends(get_db), idempotency_key: str | None = IdempotencyKeyHeader):
    account = own_account(db, user, body.from_account_id)
    amount = minor(body.amount)
    fingerprint = {"op": "transfer", "from": body.from_account_id, "to": iban_lib.normalize(body.to_iban),
                   "amount": amount, "description": body.description}
    return money_op(db, request, user, idempotency_key, fingerprint, "money.transfer",
                    lambda: banking.transfer(db, account, body.to_iban, amount, body.description),
                    TransactionOut, _tx_audit)
