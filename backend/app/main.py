import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import SQLAlchemyError

from app.database import Base, check_database_connection, engine
from app.routers import admin, auth, confidential, kyc, transactions
from app.security import get_current_user


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure database schema is created on startup without dropping any existing tables.
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as exc:
        # If DB is not ready during startup, connection checks will report status
        pass
    yield


app = FastAPI(
    title="PrivacyMesh API",
    description="Confidential computing for sensitive banking workloads",
    version="0.1.0",
    lifespan=lifespan,
)

# Allow local React frontend development servers to communicate with FastAPI.
raw_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
allowed_origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routes.
app.include_router(auth.router)
app.include_router(transactions.router)
app.include_router(kyc.router)
app.include_router(admin.router)
app.include_router(confidential.router)


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
    except (SQLAlchemyError, Exception):
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
