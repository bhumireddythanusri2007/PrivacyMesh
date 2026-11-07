from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    JSON,
    LargeBinary,
    Numeric,
    String,
    Text,
    func,
    text,
)

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(20), nullable=False, server_default=text("'customer'"))
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            "role IN ('customer', 'bank_employee', 'bank_manager', 'system_admin', 'pending_review', 'user', 'admin')",
            name="check_user_role",
        ),
    )


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)

    # Associate each transaction with its owner.
    user_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )

    account_id = Column(String(100), nullable=False, index=True)
    amount = Column(Numeric(12, 2), nullable=False)
    transaction_type = Column(String(20), nullable=False)
    status = Column(String(20), nullable=False, default="pending")
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    __table_args__ = (
        CheckConstraint(
            "amount > 0",
            name="check_transaction_amount_positive",
        ),
    )


class KYCRecord(Base):
    __tablename__ = "kyc_records"

    id = Column(Integer, primary_key=True, index=True)

    # Associate each KYC record with its owner.
    # Nullable temporarily to preserve existing records.
    user_id = Column(
        Integer,
        ForeignKey("users.id"),
        nullable=True,
        index=True,
    )

    customer_ref = Column(
        String(100), unique=True, nullable=False, index=True
    )
    document_type = Column(String(50), nullable=False)
    verification_status = Column(
        String(30), nullable=False, default="pending"
    )
    risk_category = Column(
        String(30), nullable=False, default="unassessed"
    )
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class KYCSubmission(Base):
    __tablename__ = "kyc_submissions"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    submission_ref = Column(
        String(100), unique=True, nullable=False, index=True
    )
    status = Column(String(40), nullable=False, server_default=text("'submitted'"))
    is_archived = Column(Boolean, nullable=False, server_default=text("false"))
    archived_at = Column(
        DateTime(timezone=True), nullable=True, server_default=text("NULL")
    )
    archived_by_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
        server_default=text("NULL"),
    )
    assigned_employee_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
        server_default=text("NULL"),
    )
    assigned_manager_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
        server_default=text("NULL"),
    )
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class KYCVersion(Base):
    __tablename__ = "kyc_versions"

    id = Column(Integer, primary_key=True, index=True)
    submission_id = Column(
        Integer,
        ForeignKey("kyc_submissions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    version_number = Column(Integer, nullable=False)
    is_current = Column(Boolean, nullable=False, default=True)
    document_type = Column(String(50), nullable=False)
    document_id_hash = Column(String(64), nullable=True)
    encrypted_pii = Column(LargeBinary, nullable=True)
    pii_nonce = Column(LargeBinary, nullable=True)
    attachment_filename = Column(String(255), nullable=True)
    attachment_mime_type = Column(String(100), nullable=True)
    attachment_size_bytes = Column(Integer, nullable=True)
    attachment_hash = Column(String(64), nullable=True)
    auto_validation_status = Column(
        String(30), nullable=False, default="unassessed"
    )
    auto_validation_results = Column(JSON, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class KYCReview(Base):
    __tablename__ = "kyc_reviews"

    id = Column(Integer, primary_key=True, index=True)
    submission_id = Column(
        Integer,
        ForeignKey("kyc_submissions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    version_id = Column(
        Integer,
        ForeignKey("kyc_versions.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    reviewer_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    reviewer_role = Column(String(30), nullable=False)
    action = Column(String(40), nullable=False)
    internal_notes = Column(Text, nullable=True)
    customer_notes = Column(Text, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class KYCAuditLog(Base):
    __tablename__ = "kyc_audit_log"

    id = Column(Integer, primary_key=True, index=True)
    submission_id = Column(
        Integer,
        ForeignKey("kyc_submissions.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    actor_id = Column(
        Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    actor_role = Column(String(30), nullable=False)
    event_type = Column(String(60), nullable=False)
    event_metadata = Column(JSON, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
