"""Money movement. These functions only stage changes on the session; the caller commits.

Debits are conditional UPDATEs so balances can never go negative. Rows are locked in a fixed
order - accounts by id, then savings goals, then cards - so concurrent operations cannot deadlock."""

import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app import config, iban as iban_lib
from app.models import Account, Card, GoalEntry, SavingsGoal, Transaction


class BankingError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _ref() -> str:
    return str(uuid.uuid4())


def _lock_accounts(db: Session, *account_ids: int) -> None:
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


def _entry(db: Session, account_id: int, kind: str, amount: int, balance_after: int, *, category: str,
           description: str, reference: str, **extra) -> Transaction:
    tx = Transaction(account_id=account_id, kind=kind, amount=amount, balance_after=balance_after,
                     category=category, description=description, reference=reference, **extra)
    db.add(tx)
    return tx


# ---------- accounts ----------

def deposit(db: Session, account: Account, amount: int, description: str = "") -> Transaction:
    balance = _credit(db, account.id, amount)
    tx = _entry(db, account.id, "deposit", amount, balance, category="income",
                description=description or "Alimentare cont", reference=_ref())
    db.flush()
    return tx


def withdraw(db: Session, account: Account, amount: int, description: str = "") -> Transaction:
    balance = _debit(db, account.id, amount)
    tx = _entry(db, account.id, "withdrawal", -amount, balance, category="cash",
                description=description or "Retragere numerar", reference=_ref())
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

    internal = target.owner_id == source.owner_id
    _lock_accounts(db, source.id, target.id)
    ref = _ref()
    src_balance = _debit(db, source.id, amount)
    dst_balance = _credit(db, target.id, amount)
    out_tx = _entry(db, source.id, "transfer_out", -amount, src_balance,
                    category="internal" if internal else "transfers",
                    description=description or ("Transfer între conturi" if internal else "Transfer trimis"),
                    reference=ref, counterparty_iban=target.iban,
                    counterparty_name=target.name if internal else target.owner.full_name)
    _entry(db, target.id, "transfer_in", amount, dst_balance,
           category="internal" if internal else "transfers",
           description=description or ("Transfer între conturi" if internal else "Transfer primit"),
           reference=ref, counterparty_iban=source.iban,
           counterparty_name=source.name if internal else source.owner.full_name)
    db.flush()
    return out_tx


# ---------- savings goals ----------

def _goal_credit(db: Session, goal_id: int, amount: int) -> int:
    return db.execute(
        update(SavingsGoal).where(SavingsGoal.id == goal_id)
        .values(balance=SavingsGoal.balance + amount).returning(SavingsGoal.balance)
    ).scalar_one()


def _goal_debit(db: Session, goal_id: int, amount: int) -> int:
    result = db.execute(
        update(SavingsGoal).where(SavingsGoal.id == goal_id, SavingsGoal.balance >= amount)
        .values(balance=SavingsGoal.balance - amount).returning(SavingsGoal.balance)
    ).first()
    if result is None:
        raise BankingError("Pușculița nu are suficienți bani")
    return result[0]


def _ensure_open(goal: SavingsGoal) -> None:
    if goal.closed_at is not None:
        raise BankingError("Pușculița a fost închisă", 409)


def _move_to_goal(db: Session, goal: SavingsGoal, amount: int, kind: str, ref: str) -> GoalEntry:
    acc_balance = _debit(db, goal.account_id, amount)
    goal_balance = _goal_credit(db, goal.id, amount)
    _entry(db, goal.account_id, "to_savings", -amount, acc_balance, category="savings",
           description="Rotunjire" if kind == "roundup" else f"Către {goal.name}",
           reference=ref, counterparty_name=goal.name, goal_id=goal.id)
    entry = GoalEntry(goal_id=goal.id, kind=kind, amount=amount, balance_after=goal_balance, reference=ref)
    db.add(entry)
    return entry


def goal_deposit(db: Session, goal: SavingsGoal, amount: int) -> GoalEntry:
    _ensure_open(goal)
    _lock_accounts(db, goal.account_id)
    entry = _move_to_goal(db, goal, amount, "deposit", _ref())
    db.flush()
    return entry


def goal_withdraw(db: Session, goal: SavingsGoal, amount: int) -> GoalEntry:
    _ensure_open(goal)
    _lock_accounts(db, goal.account_id)  # account before goal, same order as deposits
    ref = _ref()
    goal_balance = _goal_debit(db, goal.id, amount)
    acc_balance = _credit(db, goal.account_id, amount)
    _entry(db, goal.account_id, "from_savings", amount, acc_balance, category="savings",
           description=f"Din {goal.name}", reference=ref, counterparty_name=goal.name, goal_id=goal.id)
    entry = GoalEntry(goal_id=goal.id, kind="withdrawal", amount=-amount, balance_after=goal_balance, reference=ref)
    db.add(entry)
    db.flush()
    return entry


def close_goal(db: Session, goal: SavingsGoal) -> SavingsGoal:
    """Returns any remaining balance to the funding account and closes the goal."""
    _ensure_open(goal)
    _lock_accounts(db, goal.account_id)
    remaining = db.scalar(select(SavingsGoal.balance).where(SavingsGoal.id == goal.id).with_for_update())
    if remaining:
        goal_withdraw(db, goal, remaining)
    goal.closed_at = datetime.now(timezone.utc)
    goal.roundup_enabled = False
    db.flush()
    return goal


def _apply_roundup(db: Session, account_id: int, amount: int, ref: str) -> None:
    """Moves the spare change of a card payment (up to the next whole unit) to the account's
    round-up goal, if there is one and the account can afford it."""
    spare = -amount % 100
    if not spare:
        return
    goal = db.scalar(select(SavingsGoal).where(SavingsGoal.account_id == account_id,
                                               SavingsGoal.roundup_enabled.is_(True),
                                               SavingsGoal.closed_at.is_(None)))
    if goal is None:
        return
    current = db.scalar(select(Account.balance).where(Account.id == account_id))
    if current >= spare:
        _move_to_goal(db, goal, spare, "roundup", ref)


# ---------- cards ----------

def month_start(now: datetime | None = None) -> datetime:
    """Start of the current calendar month in the bank's timezone, as a UTC instant."""
    local = (now or datetime.now(timezone.utc)).astimezone(ZoneInfo(config.TIMEZONE))
    return local.replace(day=1, hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)


def card_spent_this_month(db: Session, card_id: int) -> int:
    total = db.scalar(select(func.coalesce(func.sum(Transaction.amount), 0)).where(
        Transaction.card_id == card_id, Transaction.kind == "card_payment",
        Transaction.created_at >= month_start()))
    return -int(total)


def card_payment(db: Session, card: Card, merchant: str, amount: int, category: str) -> Transaction:
    """Simulated purchase at a merchant with a virtual card."""
    if card.closed_at is not None:
        raise BankingError("Cardul a fost închis", 409)
    now = datetime.now(timezone.utc)
    if (card.expiry_year, card.expiry_month) < (now.year, now.month):
        raise BankingError("Cardul a expirat")

    _lock_accounts(db, card.account_id)
    # Lock the card so concurrent payments can't both slip under the monthly limit.
    locked = db.scalar(select(Card).where(Card.id == card.id).with_for_update().execution_options(populate_existing=True))
    if locked.frozen:
        raise BankingError("Cardul este înghețat")
    if locked.monthly_limit is not None and card_spent_this_month(db, card.id) + amount > locked.monthly_limit:
        raise BankingError("Plata depășește limita lunară a cardului")

    ref = _ref()
    balance = _debit(db, card.account_id, amount)
    tx = _entry(db, card.account_id, "card_payment", -amount, balance, category=category,
                description=merchant, reference=ref, counterparty_name=merchant, card_id=card.id)
    _apply_roundup(db, card.account_id, amount, ref)
    db.flush()
    return tx
