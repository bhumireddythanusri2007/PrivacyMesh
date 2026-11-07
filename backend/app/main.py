
import os
import re
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import Counter, Histogram
from sqlalchemy.exc import SQLAlchemyError

from app.database import Base, check_database_connection, engine
from app.routers import admin, auth, confidential, kyc, kyc_workflow, monitoring, transactions
from app.routers.monitoring import ERROR_COUNT, REQUEST_COUNT, REQUEST_LATENCY
from app.security import get_current_user


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create missing tables without deleting existing database data.
    try:
        Base.metadata.create_all(bind=engine)
    except Exception:
        pass
    yield


app = FastAPI(
    title="PrivacyMesh API",
    description="Confidential computing for sensitive banking workloads",
    version="0.1.0",
    lifespan=lifespan,
)

# Allow the local React frontend to communicate with FastAPI.
raw_origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
)
allowed_origins = [
    origin.strip()
    for origin in raw_origins.split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


_UUID_REGEX = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
_INT_REGEX = re.compile(r"^\d+$")


def get_normalized_endpoint(request: Request) -> str:
    """Normalize URL path to prevent metric label cardinality explosion."""
    route = request.scope.get("route")
    if route and hasattr(route, "path"):
        return route.path

    path = request.url.path
    segments = path.strip("/").split("/")
    if not segments or segments == [""]:
        return "/"

    normalized = []
    for seg in segments:
        if _UUID_REGEX.match(seg) or _INT_REGEX.match(seg):
            normalized.append("{id}")
        else:
            normalized.append(seg)
    return "/" + "/".join(normalized)


# Collect HTTP request counts, status codes, and response latency.
@app.middleware("http")
async def collect_request_metrics(request: Request, call_next):
    start_time = time.perf_counter()
    status_code = 500

    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        endpoint = get_normalized_endpoint(request)
        duration = max(time.perf_counter() - start_time, 0.0)

        REQUEST_COUNT.labels(
            method=request.method,
            endpoint=endpoint,
            status=str(status_code),
        ).inc()

        REQUEST_LATENCY.labels(
            method=request.method,
            endpoint=endpoint,
        ).observe(duration)

        if status_code >= 500:
            ERROR_COUNT.labels(
                method=request.method,
                endpoint=endpoint,
                error_type="5xx",
            ).inc()
        elif status_code >= 400:
            ERROR_COUNT.labels(
                method=request.method,
                endpoint=endpoint,
                error_type="4xx",
            ).inc()


# Register API routes.
app.include_router(auth.router)
app.include_router(transactions.router)
app.include_router(kyc.router)
app.include_router(kyc_workflow.router)
app.include_router(admin.router)
app.include_router(confidential.router)
app.include_router(monitoring.router)


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
