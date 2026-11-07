import os
import psutil
from fastapi import APIRouter
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from starlette.responses import Response

router = APIRouter(tags=["Monitoring"])

REQUEST_COUNT = Counter(
    "privacymesh_http_requests_total",
    "Total HTTP requests",
    ["method", "endpoint", "status"],
)

REQUEST_LATENCY = Histogram(
    "privacymesh_http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["method", "endpoint"],
)

ERROR_COUNT = Counter(
    "privacymesh_http_errors_total",
    "Total HTTP error responses partitioned by status class",
    ["method", "endpoint", "error_type"],
)

DB_CONNECTED = Gauge(
    "privacymesh_db_connected",
    "Database connectivity status (1 = connected, 0 = disconnected)",
)

PROCESS_CPU_PERCENT = Gauge(
    "privacymesh_process_cpu_percent",
    "FastAPI process CPU utilization percentage",
)

PROCESS_MEMORY_PERCENT = Gauge(
    "privacymesh_process_memory_percent",
    "FastAPI process memory consumption percentage",
)

PROCESS_MEMORY_BYTES = Gauge(
    "privacymesh_process_memory_bytes",
    "FastAPI process resident set size (RSS) memory in bytes",
)


def update_system_metrics() -> bool:
    """Sample host/process metrics and verify database connection."""
    db_ok = False
    try:
        from app.database import check_database_connection
        db_ok = bool(check_database_connection())
    except Exception:
        db_ok = False
    DB_CONNECTED.set(1.0 if db_ok else 0.0)

    try:
        PROCESS_CPU_PERCENT.set(psutil.cpu_percent(interval=None))
        mem = psutil.virtual_memory()
        PROCESS_MEMORY_PERCENT.set(mem.percent)
        proc = psutil.Process()
        PROCESS_MEMORY_BYTES.set(float(proc.memory_info().rss))
    except Exception:
        pass

    return db_ok


@router.get("/metrics", include_in_schema=False)
def metrics():
    update_system_metrics()
    return Response(
        content=generate_latest(),
        headers={"Content-Type": CONTENT_TYPE_LATEST},
    )


@router.get("/monitoring/status")
def monitoring_status():
    db_ok = update_system_metrics()
    memory = psutil.virtual_memory()

    return {
        "status": "active",
        "cpu_percent": psutil.cpu_percent(interval=0.2),
        "memory_percent": memory.percent,
        "memory_total_mb": round(memory.total / (1024 * 1024), 2),
        "metrics_endpoint": "/metrics",
        "database_connected": db_ok,
        "note": "Measurements reflect the environment visible to the backend process.",
    }
