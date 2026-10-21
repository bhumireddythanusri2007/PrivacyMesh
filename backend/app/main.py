
from fastapi import Depends, FastAPI, HTTPException
from sqlalchemy.exc import SQLAlchemyError

from app.database import check_database_connection
from app.routers import auth, transactions, kyc, admin
from app.security import get_current_user

app = FastAPI(
    title="PrivacyMesh API",
    description="Confidential computing for sensitive banking workloads",
    version="0.1.0",
)

app.include_router(auth.router)
app.include_router(transactions.router)
app.include_router(kyc.router)
app.include_router(admin.router)


@app.get("/")
def home():
    return {
        "message": "PrivacyMesh API is running",
        "status": "success",
    }


@app.get("/health")
def health():
    return {"status": "healthy"}


@app.get("/db-health")
def database_health():
    try:
        check_database_connection()
        return {
            "status": "connected",
            "database": "PostgreSQL",
        }
    except SQLAlchemyError:
        raise HTTPException(
            status_code=503,
            detail="Database connection failed",
        )


@app.get("/protected")
def protected_route(current_user: dict = Depends(get_current_user)):
    return {
        "message": "Authentication successful",
        "user": current_user,
    }
