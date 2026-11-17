import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.security import RoleCode, require_roles
from app.db.session import get_db
from app.models import (
    AdministrativeTarget,
    AuditLog,
    Campaign,
    CampaignAlert,
    CampaignDay,
    CommandDisplaySession,
    DailyVaccinationReport,
    SecurityAffectedSettlement,
    User,
    Woreda,
    Zone,
)

command_router = APIRouter(tags=["Command Room & Governance"])


class CreateDisplaySessionPayload(BaseModel):
    label: str = Field(default="OHB Command Video Wall", min_length=2, max_length=160)
    default_layout: int = Field(default=1, ge=1, le=5)
    rotation_seconds: int = Field(default=30, ge=10, le=300)
    expires_in_hours: int = Field(default=24, ge=1, le=720)


def _hash_display_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


@command_router.get("/command-room/sessions")
def list_display_sessions(
    current_user: User = Depends(require_roles([RoleCode.REGIONAL_ADMIN, RoleCode.REGIONAL_COORDINATION])),
    db: Session = Depends(get_db),
):
    rows = db.query(CommandDisplaySession).order_by(CommandDisplaySession.created_at.desc()).all()
    return [
        {
            "id": str(r.id),
            "label": r.label,
            "token_prefix": r.token_prefix,
            "default_layout": r.default_layout,
            "rotation_seconds": r.rotation_seconds,
            "is_active": r.is_active,
            "created_at": r.created_at,
            "expires_at": r.expires_at,
            "revoked_at": r.revoked_at,
            "last_accessed_at": r.last_accessed_at,
        }
        for r in rows
    ]


@command_router.post("/command-room/sessions", status_code=status.HTTP_201_CREATED)
def create_display_session(
    payload: CreateDisplaySessionPayload,
    current_user: User = Depends(require_roles([RoleCode.REGIONAL_ADMIN, RoleCode.REGIONAL_COORDINATION])),
    db: Session = Depends(get_db),
):
    raw_token = f"opcms_disp_{secrets.token_hex(24)}"
    now = datetime.now(timezone.utc)
    session = CommandDisplaySession(
        label=payload.label.strip(),
        token_prefix=f"{raw_token[:18]}...",
        token_hash=_hash_display_token(raw_token),
        default_layout=payload.default_layout,
        rotation_seconds=payload.rotation_seconds,
        is_active=True,
        created_by_id=current_user.id,
        expires_at=now + timedelta(hours=payload.expires_in_hours),
    )
    db.add(session)
    db.add(
        AuditLog(
            actor_user_id=current_user.id,
            actor_username=current_user.username,
            actor_role=current_user.role.code,
            action="CREATE_COMMAND_DISPLAY_SESSION",
            entity_type="CommandDisplaySession",
            entity_id=str(session.id),
            details={"label": session.label, "expires_in_hours": payload.expires_in_hours},
        )
    )
    db.commit()
    db.refresh(session)
    return {
        "session": {
            "id": str(session.id),
            "label": session.label,
            "token_prefix": session.token_prefix,
            "default_layout": session.default_layout,
            "rotation_seconds": session.rotation_seconds,
            "is_active": session.is_active,
            "created_at": session.created_at,
            "expires_at": session.expires_at,
        },
        "display_token": raw_token,
    }


@command_router.post("/command-room/sessions/{session_id}/revoke")
def revoke_display_session(
    session_id: UUID,
    current_user: User = Depends(require_roles([RoleCode.REGIONAL_ADMIN, RoleCode.REGIONAL_COORDINATION])),
    db: Session = Depends(get_db),
):
    session = db.query(CommandDisplaySession).filter(CommandDisplaySession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Command Room display session not found.")
    session.is_active = False
    session.revoked_at = datetime.now(timezone.utc)
    session.revoked_by_id = current_user.id
    db.add(
        AuditLog(
            actor_user_id=current_user.id,
            actor_username=current_user.username,
            actor_role=current_user.role.code,
            action="REVOKE_COMMAND_DISPLAY_SESSION",
            entity_type="CommandDisplaySession",
            entity_id=str(session.id),
            details={"label": session.label},
        )
    )
    db.commit()
    return {"id": str(session.id), "is_active": False, "revoked_at": session.revoked_at}


@command_router.get("/command-room/snapshot")
def get_command_room_snapshot(
    display_token: Optional[str] = Query(default=None),
    x_display_token: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    raw_token = display_token or x_display_token
    if not raw_token or not raw_token.startswith("opcms_disp_"):
        raise HTTPException(status_code=401, detail="Valid Command Room display_token is required.")

    candidate_hash = _hash_display_token(raw_token)
    now = datetime.now(timezone.utc)
    active_sessions = (
        db.query(CommandDisplaySession)
        .filter(CommandDisplaySession.is_active.is_(True), CommandDisplaySession.revoked_at.is_(None))
        .all()
    )
    matched: Optional[CommandDisplaySession] = None
    for s in active_sessions:
        if s.expires_at and s.expires_at <= now:
            continue
        if hmac.compare_digest(s.token_hash, candidate_hash):
            matched = s
            break
    if not matched:
        raise HTTPException(status_code=401, detail="Command Room display token is invalid, expired, or revoked.")

    matched.last_accessed_at = now
    db.commit()

    total_zones = db.query(func.count(Zone.id)).scalar() or 0
    total_woredas = db.query(func.count(Woreda.id)).scalar() or 0
    total_planned = db.query(func.coalesce(func.sum(AdministrativeTarget.total_planned_target), 0)).scalar() or 0
    total_daily = db.query(func.coalesce(func.sum(AdministrativeTarget.daily_target), 0)).scalar() or 0
    total_vax_0_59 = db.query(func.coalesce(func.sum(DailyVaccinationReport.total_vaccinated_0_59m), 0)).scalar() or 0
    open_alerts = db.query(func.count(CampaignAlert.id)).filter(CampaignAlert.resolution_status != "Resolved").scalar() or 0
    sec_settlements = db.query(func.count(SecurityAffectedSettlement.id)).scalar() or 0

    return {
        "generated_at": now.isoformat(),
        "read_only": True,
        "session_label": matched.label,
        "overview_totals": {
            "total_zones": total_zones,
            "total_woredas": total_woredas,
            "computed_planned_target": int(total_planned),
            "computed_daily_target": int(total_daily),
            "total_vaccinated_0_59m": int(total_vax_0_59),
            "open_alerts_count": open_alerts,
            "security_settlements_count": sec_settlements,
        },
        "campaign": db.query(Campaign).first(),
        "open_days": db.query(CampaignDay).filter(CampaignDay.is_open_for_reporting.is_(True)).count(),
    }
