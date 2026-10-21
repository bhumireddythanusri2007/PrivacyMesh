
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import KYCRecord
from app.security import get_current_user

router = APIRouter(prefix="/kyc", tags=["KYC"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post("", status_code=status.HTTP_201_CREATED)
def create_kyc_record(
    customer_ref: str,
    document_type: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not customer_ref.strip() or not document_type.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Customer reference and document type are required",
        )

    existing_record = (
        db.query(KYCRecord)
        .filter(KYCRecord.customer_ref == customer_ref)
        .first()
    )

    if existing_record:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Customer reference already exists",
        )

    record = KYCRecord(
        user_id=current_user["id"],
        customer_ref=customer_ref,
        document_type=document_type,
        verification_status="pending",
        risk_category="unassessed",
    )

    db.add(record)
    db.commit()
    db.refresh(record)

    return {
        "id": record.id,
        "user_id": record.user_id,
        "customer_ref": record.customer_ref,
        "document_type": record.document_type,
        "verification_status": record.verification_status,
        "risk_category": record.risk_category,
        "created_at": record.created_at,
    }


@router.get("")
def get_kyc_records(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(KYCRecord)

    # Admins can view all KYC records.
    # Regular users can view only their own records.
    if current_user["role"] != "admin":
        query = query.filter(
            KYCRecord.user_id == current_user["id"]
        )

    return query.order_by(KYCRecord.id.desc()).all()
