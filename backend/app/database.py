import os
from collections.abc import Generator
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, declarative_base, sessionmaker

# Load .env file from project root or current environment
_env_path = Path(__file__).resolve().parent.parent.parent / ".env"
if _env_path.exists():
    load_dotenv(dotenv_path=_env_path)
else:
    load_dotenv()

ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    app_db_user = os.getenv("APP_DB_USER", "privacy_app")
    app_db_pass = os.getenv("APP_DB_PASSWORD")
    if app_db_pass:
        db_host = os.getenv("DB_HOST", "localhost")
        db_port = os.getenv("DB_PORT", "5433" if db_host in ("localhost", "127.0.0.1") else "5432")
        db_name = os.getenv("POSTGRES_DB", "privacymesh")
        DATABASE_URL = f"postgresql+psycopg://{app_db_user}:{app_db_pass}@{db_host}:{db_port}/{db_name}"
    elif ENVIRONMENT == "production":
        raise RuntimeError("DATABASE_URL is required in production environment")
    else:
        DATABASE_URL = "sqlite:///:memory:"

if ENVIRONMENT == "production" and (not DATABASE_URL or DATABASE_URL.startswith("sqlite")):
    raise RuntimeError("Valid PostgreSQL DATABASE_URL is required in production environment; SQLite is rejected")

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=not DATABASE_URL.startswith("sqlite"),
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    expire_on_commit=False,
    bind=engine,
)

Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """Provide a transactional database session per request and clean it up reliably."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def check_database_connection() -> bool:
    """Execute a simple query to verify database connectivity."""
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return True
