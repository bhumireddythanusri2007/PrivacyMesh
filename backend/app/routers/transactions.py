
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Transaction
from app.schemas import TransactionCreate, TransactionResponse
from app.security import get_current_user

router = APIRouter(prefix="/transactions", tags=["Transactions"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.post(
    "",
    response_model=TransactionResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_transaction(
    transaction_data: TransactionCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    new_transaction = Transaction(
        user_id=current_user["id"],
        account_id=transaction_data.account_id,
        amount=transaction_data.amount,
        transaction_type=transaction_data.transaction_type,
        status="completed",
    )

    db.add(new_transaction)
    db.commit()
    db.refresh(new_transaction)

    return new_transaction


@router.get("", response_model=list[TransactionResponse])
def get_my_transactions(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return (
        db.query(Transaction)
        .filter(Transaction.user_id == current_user["id"])
        .order_by(Transaction.created_at.desc())
        .all()
    )
