from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from app.config import CARD_PAYMENT_CATEGORIES, SUPPORTED_CURRENCIES
from app.money import to_major

# Amounts travel as decimal strings ("12.50"); internally they are integer minor units.
Money = Annotated[Decimal, BeforeValidator(lambda v: to_major(v) if isinstance(v, int) else v)]
PositiveAmount = Annotated[Decimal, Field(gt=0)]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- auth ----------

class RegisterIn(BaseModel):
    email: str = Field(max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    full_name: str = Field(min_length=2, max_length=255)
    password: str = Field(min_length=8, max_length=72)


class LoginIn(BaseModel):
    email: str
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=72)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(ORM):
    id: int
    email: str
    full_name: str
    created_at: datetime


# ---------- accounts & transactions ----------

class AccountCreate(BaseModel):
    name: str = Field(default="Cont curent", min_length=1, max_length=100)
    currency: Literal[SUPPORTED_CURRENCIES] = "RON"  # type: ignore[valid-type]


class AccountUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class AccountOut(ORM):
    id: int
    iban: str
    name: str
    currency: str
    balance: Money
    created_at: datetime


class AmountIn(BaseModel):
    amount: PositiveAmount
    description: str = Field(default="", max_length=140)


class TransferIn(AmountIn):
    from_account_id: int
    to_iban: str = Field(min_length=15, max_length=40)


class TransactionOut(ORM):
    id: int
    account_id: int
    kind: str
    amount: Money
    balance_after: Money
    category: str
    counterparty_name: str | None
    counterparty_iban: str | None
    card_id: int | None
    goal_id: int | None
    description: str
    reference: str
    created_at: datetime


# ---------- savings goals ----------

class GoalCreate(BaseModel):
    account_id: int
    name: str = Field(min_length=1, max_length=60)
    emoji: str = Field(default="🎯", min_length=1, max_length=16)
    target: PositiveAmount
    roundup_enabled: bool = False
    deadline: date | None = None


class GoalUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    emoji: str | None = Field(default=None, min_length=1, max_length=16)
    target: PositiveAmount | None = None
    roundup_enabled: bool | None = None
    deadline: date | None = None


class GoalAmountIn(BaseModel):
    amount: PositiveAmount


class GoalOut(ORM):
    id: int
    account_id: int
    currency: str
    name: str
    emoji: str
    target: Money
    balance: Money
    roundup_enabled: bool
    deadline: date | None
    created_at: datetime
    closed_at: datetime | None


class GoalEntryOut(ORM):
    id: int
    goal_id: int
    kind: str
    amount: Money
    balance_after: Money
    reference: str
    created_at: datetime


# ---------- cards ----------

class CardCreate(BaseModel):
    account_id: int
    label: str = Field(default="Card virtual", min_length=1, max_length=40)


class CardUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=40)
    frozen: bool | None = None
    monthly_limit: PositiveAmount | None = None  # send null to remove the limit


class CardOut(ORM):
    id: int
    account_id: int
    currency: str
    label: str
    holder_name: str
    last4: str
    expiry_month: int
    expiry_year: int
    frozen: bool
    monthly_limit: Money | None
    spent_this_month: Money
    created_at: datetime


class CardDetailsOut(BaseModel):
    pan: str
    cvv: str
    expiry_month: int
    expiry_year: int


class CardPaymentIn(BaseModel):
    merchant: str = Field(min_length=1, max_length=100)
    amount: PositiveAmount
    category: Literal[CARD_PAYMENT_CATEGORIES] = "other"  # type: ignore[valid-type]


# ---------- beneficiaries ----------

class BeneficiaryIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    iban: str = Field(min_length=15, max_length=40)


class BeneficiaryUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class BeneficiaryOut(ORM):
    id: int
    name: str
    iban: str
    created_at: datetime


# ---------- statistics ----------

class MonthTotals(BaseModel):
    month: str
    income: Money
    expenses: Money


class CategoryTotal(BaseModel):
    category: str
    amount: Money
    count: int
    share: float


class StatsOut(BaseModel):
    account_id: int
    currency: str
    month: str
    months: list[MonthTotals]
    total_income: Money
    total_expenses: Money
    previous_expenses: Money | None
    categories: list[CategoryTotal]
