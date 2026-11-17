from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models.auth import User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)


class RoleCode:
    REGIONAL_ADMIN = "REGIONAL_SYSTEM_ADMIN"
    REGIONAL_COORDINATION = "REGIONAL_COORDINATION_TEAM"
    ZONE_ADMIN = "ZONE_ADMIN"
    WOREDA_OFFICER = "WOREDA_REPORTING_OFFICER"
    MONITORING_OFFICER = "MONITORING_OFFICER"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    return pwd_context.verify(plain_password, password_hash)


def create_access_token(user_id: UUID, role_code: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user_id),
        "role": role_code,
        "exp": expire,
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials were not provided.",
        )
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.JWT_SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
        )
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
        ) from exc

    user = db.query(User).filter(User.id == UUID(user_id), User.is_active.is_(True)).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account not found or inactive.",
        )
    return user


def require_roles(allowed_roles: Iterable[str]):
    allowed = set(allowed_roles)

    def _checker(current_user: User = Depends(get_current_user)) -> User:
        if not current_user.role or current_user.role.code not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient role permissions for this operation.",
            )
        return current_user

    return _checker


def assert_woreda_scope(user: User, woreda_zone_id: UUID, woreda_id: UUID) -> None:
    role_code = user.role.code
    if role_code in (RoleCode.REGIONAL_ADMIN, RoleCode.REGIONAL_COORDINATION):
        return
    if role_code == RoleCode.MONITORING_OFFICER:
        if user.zone_id and user.zone_id != woreda_zone_id:
            raise HTTPException(status_code=403, detail="Outside assigned zone scope.")
        if user.woreda_id and user.woreda_id != woreda_id:
            raise HTTPException(status_code=403, detail="Outside assigned woreda scope.")
        return
    if role_code == RoleCode.ZONE_ADMIN:
        if user.zone_id != woreda_zone_id:
            raise HTTPException(status_code=403, detail="Zone Administrators can only access their assigned zone.")
        return
    if role_code == RoleCode.WOREDA_OFFICER:
        if user.woreda_id != woreda_id:
            raise HTTPException(status_code=403, detail="Woreda Reporting Officers can only access their assigned woreda.")
        return
    raise HTTPException(status_code=403, detail="Access denied.")
