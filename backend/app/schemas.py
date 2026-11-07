from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


# ---------- User schemas ----------

class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=8, max_length=128)
    # Public registration only creates customer accounts. The 'role' field here
    # is accepted for schema compatibility but ignored by the registration endpoint,
    # which always relies on the database server_default ('customer').
    role: Literal["customer", "user"] = "customer"


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


# ---------- Legacy KYC schemas ----------

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


# ---------- Modern KYC Workflow schemas ----------

class KYCVersionCreate(BaseModel):
    document_type: str = Field(min_length=1, max_length=50)


class KYCVersionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    submission_id: int
    version_number: int
    is_current: bool
    document_type: str
    auto_validation_status: str
    auto_validation_results: Any | None = None
    created_at: datetime


class KYCSubmissionCreate(BaseModel):
    submission_ref: str = Field(min_length=1, max_length=100)
    document_type: str = Field(min_length=1, max_length=50)


class KYCSubmissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    customer_id: int | None = None
    submission_ref: str
    status: str
    is_archived: bool
    archived_at: datetime | None = None
    archived_by_id: int | None = None
    assigned_employee_id: int | None = None
    assigned_manager_id: int | None = None
    created_at: datetime
    updated_at: datetime
    current_version: KYCVersionResponse | None = None


class KYCDecisionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    submission_id: int
    version_id: int
    action: str
    customer_notes: str | None = None
    created_at: datetime


class KYCEmployeeRecommendationRequest(BaseModel):
    action: Literal["recommend_approve", "recommend_reject", "request_correction"]
    internal_notes: str = Field(min_length=1, max_length=4000)


class KYCManagerDecisionRequest(BaseModel):
    action: Literal["approve", "reject", "manager_request_correction"]
    internal_notes: str | None = Field(default=None, max_length=4000)
    customer_notes: str = Field(min_length=1, max_length=2000)


class KYCAssignEmployeeRequest(BaseModel):
    assigned_employee_id: int


class KYCReviewResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    submission_id: int
    version_id: int
    reviewer_id: int
    reviewer_role: str
    action: str
    internal_notes: str | None = None
    customer_notes: str | None = None
    created_at: datetime
