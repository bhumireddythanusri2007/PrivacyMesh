import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
import jwt
from pwdlib import PasswordHash
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

# Load .env file from project root or current environment
_env_path = Path(__file__).resolve().parent.parent.parent / ".env"
if _env_path.exists():
    load_dotenv(dotenv_path=_env_path)
else:
    load_dotenv()

password_hash = PasswordHash.recommended()
bearer_scheme = HTTPBearer()

ENVIRONMENT = os.getenv("ENVIRONMENT", "development").lower()

DEV_DEFAULT_JWT_SECRET = "dev-insecure-privacymesh-secret-key-change-in-production"

JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY")

if ENVIRONMENT == "production":
    if not JWT_SECRET_KEY:
        raise RuntimeError("JWT_SECRET_KEY is required in production environment")
    if JWT_SECRET_KEY == DEV_DEFAULT_JWT_SECRET or len(JWT_SECRET_KEY) < 32:
        raise RuntimeError("Insecure or insufficient JWT_SECRET_KEY cannot be used in production environment")
elif not JWT_SECRET_KEY:
    JWT_SECRET_KEY = DEV_DEFAULT_JWT_SECRET

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30


def hash_password(password: str) -> str:
    """Hash a password before storing it."""
    return password_hash.hash(password)


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify a password against its stored hash."""
    try:
        return password_hash.verify(password, stored_hash)
    except Exception:
        return False


def create_access_token(
    user_id: int,
    username: str,
    role: str,
) -> str:
    """Create a signed JWT access token."""
    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )

    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "exp": expires_at,
    }

    return jwt.encode(
        payload,
        JWT_SECRET_KEY,
        algorithm=JWT_ALGORITHM,
    )


def decode_access_token(token: str) -> dict:
    """Validate and decode a JWT access token."""
    return jwt.decode(
        token,
        JWT_SECRET_KEY,
        algorithms=[JWT_ALGORITHM],
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    """Validate the bearer token and return the authenticated user."""
    token = credentials.credentials

    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
        username = payload.get("username")
        role = payload.get("role")

        if not user_id or not username or not role:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token",
            )

        return {
            "id": int(user_id),
            "username": username,
            "role": role,
        }

    except (jwt.InvalidTokenError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


def require_role(*allowed_roles: str):
    """Factory dependency verifying the authenticated user has one of the allowed roles."""
    def role_checker(current_user: dict = Depends(get_current_user)) -> dict:
        if current_user["role"] not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access restricted to roles: {', '.join(allowed_roles)}",
            )
        return current_user
    return role_checker


require_customer = require_role("customer", "user")
require_bank_employee = require_role("bank_employee")
require_bank_manager = require_role("bank_manager")
require_system_admin = require_role("system_admin", "admin")
require_admin = require_role("system_admin", "admin")
