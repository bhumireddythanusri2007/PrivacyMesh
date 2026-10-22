from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, Transaction, KYCRecord
from app.schemas import UserResponse
from app.security import get_current_user

router = APIRouter(prefix="/admin", tags=["Admin"])


def require_admin(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user


@router.get("/summary")
def get_admin_summary(
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return {
        "total_users": db.query(User).count(),
        "total_transactions": db.query(Transaction).count(),
        "total_kyc_records": db.query(KYCRecord).count(),
    }


@router.get("/users", response_model=list[UserResponse])
def get_all_users(
    admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
):
    return db.query(User).order_by(User.id).all()
