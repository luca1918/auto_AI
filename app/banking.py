"""Money movement. These functions only stage changes on the session; the caller commits.

Debits are conditional UPDATEs so balances can never go negative, and transfers lock
both accounts in id order so opposing concurrent transfers cannot deadlock."""

import uuid

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app import iban as iban_lib
from app.models import Account, Transaction


class BankingError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _lock(db: Session, *account_ids: int) -> None:
    db.execute(select(Account.id).where(Account.id.in_(account_ids)).order_by(Account.id).with_for_update())


def _debit(db: Session, account_id: int, amount: int) -> int:
    result = db.execute(
        update(Account)
        .where(Account.id == account_id, Account.balance >= amount)
        .values(balance=Account.balance - amount)
        .returning(Account.balance)
    ).first()
    if result is None:
        raise BankingError("Fonduri insuficiente")
    return result[0]


def _credit(db: Session, account_id: int, amount: int) -> int:
    return db.execute(
        update(Account)
        .where(Account.id == account_id)
        .values(balance=Account.balance + amount)
        .returning(Account.balance)
    ).scalar_one()


def deposit(db: Session, account: Account, amount: int, description: str = "") -> Transaction:
    balance = _credit(db, account.id, amount)
    tx = Transaction(account_id=account.id, kind="deposit", amount=amount, balance_after=balance,
                     description=description or "Depunere", reference=str(uuid.uuid4()))
    db.add(tx)
    db.flush()
    return tx


def withdraw(db: Session, account: Account, amount: int, description: str = "") -> Transaction:
    balance = _debit(db, account.id, amount)
    tx = Transaction(account_id=account.id, kind="withdrawal", amount=-amount, balance_after=balance,
                     description=description or "Retragere", reference=str(uuid.uuid4()))
    db.add(tx)
    db.flush()
    return tx


def transfer(db: Session, source: Account, to_iban: str, amount: int, description: str = "") -> Transaction:
    to_iban = iban_lib.normalize(to_iban)
    if not iban_lib.is_valid(to_iban):
        raise BankingError("IBAN invalid")
    if to_iban == source.iban:
        raise BankingError("Nu poți transfera în același cont")
    target = db.scalar(select(Account).where(Account.iban == to_iban))
    if target is None:
        raise BankingError("Contul destinatar nu există în bancă", 404)
    if target.currency != source.currency:
        raise BankingError("Transferurile între monede diferite nu sunt suportate încă")

    _lock(db, source.id, target.id)
    ref = str(uuid.uuid4())
    src_balance = _debit(db, source.id, amount)
    dst_balance = _credit(db, target.id, amount)
    out_tx = Transaction(account_id=source.id, kind="transfer_out", amount=-amount,
                         balance_after=src_balance, counterparty_iban=target.iban,
                         description=description or "Transfer trimis", reference=ref)
    db.add_all([
        out_tx,
        Transaction(account_id=target.id, kind="transfer_in", amount=amount,
                    balance_after=dst_balance, counterparty_iban=source.iban,
                    description=description or "Transfer primit", reference=ref),
    ])
    db.flush()
    return out_tx
