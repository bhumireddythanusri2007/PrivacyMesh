from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import KYCRecord
from app.schemas import KYCRecordResponse
from app.security import get_current_user

router = APIRouter(prefix="/kyc", tags=["KYC"])


@router.post(
    "",
    response_model=KYCRecordResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_kyc_record(
    customer_ref: str,
    document_type: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    trimmed_ref = customer_ref.strip()
    trimmed_doc = document_type.strip()

    if not trimmed_ref or not trimmed_doc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Customer reference and document type are required",
        )

    existing_record = (
        db.query(KYCRecord)
        .filter(KYCRecord.customer_ref == trimmed_ref)
        .first()
    )

    if existing_record:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Customer reference already exists",
        )

    record = KYCRecord(
        user_id=current_user["id"],
        customer_ref=trimmed_ref,
        document_type=trimmed_doc,
        verification_status="pending",
        risk_category="unassessed",
    )

    db.add(record)
    db.commit()
    db.refresh(record)

    return record


@router.get("", response_model=list[KYCRecordResponse])
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
