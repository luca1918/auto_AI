from datetime import date, datetime, timezone

from sqlalchemy import (JSON, BigInteger, Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, String,
                        Text, UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255))
    password_hash: Mapped[str] = mapped_column(String(255))
    failed_logins: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    accounts: Mapped[list["Account"]] = relationship(back_populates="owner")


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (CheckConstraint("balance >= 0", name="balance_non_negative"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    iban: Mapped[str] = mapped_column(String(34), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    currency: Mapped[str] = mapped_column(String(3))
    # Stored in minor units (bani / cents) to avoid floating point errors.
    balance: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    owner: Mapped[User] = relationship(back_populates="accounts")


class Transaction(Base):
    """One ledger entry per affected account; a transfer creates two linked entries."""

    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    # deposit | withdrawal | transfer_in | transfer_out | card_payment | to_savings | from_savings
    kind: Mapped[str] = mapped_column(String(20))
    amount: Mapped[int] = mapped_column(BigInteger)  # signed, minor units
    balance_after: Mapped[int] = mapped_column(BigInteger)
    category: Mapped[str] = mapped_column(String(20), default="other", server_default="other", index=True)
    counterparty_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    counterparty_iban: Mapped[str | None] = mapped_column(String(34), nullable=True)
    card_id: Mapped[int | None] = mapped_column(ForeignKey("cards.id"), nullable=True, index=True)
    goal_id: Mapped[int | None] = mapped_column(ForeignKey("savings_goals.id"), nullable=True, index=True)
    description: Mapped[str] = mapped_column(String(140), default="")
    reference: Mapped[str] = mapped_column(String(36), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class IdempotencyKey(Base):
    """Remembers the response of a money-moving request so client retries don't repeat it."""

    __tablename__ = "idempotency_keys"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_idempotency_user_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    key: Mapped[str] = mapped_column(String(255))
    request_hash: Mapped[str] = mapped_column(String(64))
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(50), index=True)
    ip: Mapped[str | None] = mapped_column(String(45), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class SavingsGoal(Base):
    """A savings pot ("pușculiță") funded from one of the customer's accounts, in its currency."""

    __tablename__ = "savings_goals"
    __table_args__ = (CheckConstraint("balance >= 0", name="goal_balance_non_negative"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    emoji: Mapped[str] = mapped_column(String(16), default="🎯")
    target: Mapped[int] = mapped_column(BigInteger)
    balance: Mapped[int] = mapped_column(BigInteger, default=0)
    roundup_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    account: Mapped[Account] = relationship()


class GoalEntry(Base):
    __tablename__ = "goal_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    goal_id: Mapped[int] = mapped_column(ForeignKey("savings_goals.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # deposit | withdrawal | roundup
    amount: Mapped[int] = mapped_column(BigInteger)  # signed, minor units
    balance_after: Mapped[int] = mapped_column(BigInteger)
    reference: Mapped[str] = mapped_column(String(36), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Card(Base):
    """Virtual debit card. The full number and CVV are stored encrypted (see app/cards.py)."""

    __tablename__ = "cards"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    label: Mapped[str] = mapped_column(String(40))
    last4: Mapped[str] = mapped_column(String(4))
    expiry_month: Mapped[int] = mapped_column(Integer)
    expiry_year: Mapped[int] = mapped_column(Integer)
    secret: Mapped[str] = mapped_column(Text)
    frozen: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    monthly_limit: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    account: Mapped[Account] = relationship()


class Beneficiary(Base):
    __tablename__ = "beneficiaries"
    __table_args__ = (UniqueConstraint("owner_id", "iban", name="uq_beneficiary_owner_iban"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    iban: Mapped[str] = mapped_column(String(34))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
