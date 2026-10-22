from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


# ---------- User schemas ----------

class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=8, max_length=128)
    role: Literal["user"] = "user"


class UserLogin(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: str
    created_at: datetime


# ---------- Transaction schemas ----------

class TransactionCreate(BaseModel):
    account_id: str = Field(min_length=1, max_length=100)
    amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2)
    transaction_type: Literal["deposit", "withdrawal", "transfer"]


class TransactionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    account_id: str
    amount: Decimal
    transaction_type: str
    status: str
    created_at: datetime


# ---------- KYC schemas ----------

class KYCRecordCreate(BaseModel):
    customer_ref: str = Field(min_length=1, max_length=100)
    document_type: str = Field(min_length=1, max_length=50)


class KYCRecordResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int | None = None
    customer_ref: str
    document_type: str
    verification_status: str
    risk_category: str
    created_at: datetime
