from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config import SUPPORTED_CURRENCIES
from app.money import to_major


class RegisterIn(BaseModel):
    email: str = Field(max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    full_name: str = Field(min_length=2, max_length=255)
    password: str = Field(min_length=8, max_length=72)


class LoginIn(BaseModel):
    email: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    email: str
    full_name: str


class AccountCreate(BaseModel):
    name: str = Field(default="Cont curent", min_length=1, max_length=100)
    currency: Literal[SUPPORTED_CURRENCIES] = "RON"  # type: ignore[valid-type]


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    iban: str
    name: str
    currency: str
    balance: Decimal
    created_at: datetime

    @field_validator("balance", mode="before")
    @classmethod
    def _minor_to_major(cls, v):
        return to_major(v) if isinstance(v, int) else v


class AmountIn(BaseModel):
    amount: Decimal = Field(gt=0)
    description: str = Field(default="", max_length=140)


class TransferIn(AmountIn):
    from_account_id: int
    to_iban: str = Field(min_length=15, max_length=40)


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    account_id: int
    kind: str
    amount: Decimal
    balance_after: Decimal
    counterparty_iban: str | None
    description: str
    reference: str
    created_at: datetime

    @field_validator("amount", "balance_after", mode="before")
    @classmethod
    def _minor_to_major(cls, v):
        return to_major(v) if isinstance(v, int) else v
