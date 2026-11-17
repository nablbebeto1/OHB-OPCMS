import asyncio
import json
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import RoleCode, get_current_user, require_roles
from app.db.session import get_db
from app.models import (
    Campaign,
    CampaignAlert,
    GisBoundaryLayer,
    NotificationDispatchLog,
    NotificationProviderConfig,
    PerformanceThresholdConfig,
    User,
)

monitoring_router = APIRouter()


class ThresholdUpdateRequest(BaseModel):
    high_coverage_min_pct: Optional[float] = Field(default=None, ge=0, le=200)
    medium_coverage_min_pct: Optional[float] = Field(default=None, ge=0, le=200)
    high_completeness_min_pct: Optional[float] = Field(default=None, ge=0, le=100)
    high_wastage_alert_pct: Optional[float] = Field(default=None, ge=0, le=100)
    late_report_cutoff_hour_utc: Optional[int] = Field(default=None, ge=0, le=23)
    declining_performance_drop_pct: Optional[float] = Field(default=None, ge=0, le=100)
    notes: str = ""


class GisLayerUploadRequest(BaseModel):
    name: str
    admin_level: str
    source_citation: str
    geojson: dict[str, Any]


class AlertActionRequest(BaseModel):
    resolution_notes: Optional[str] = None


class ProviderConfigUpdateRequest(BaseModel):
    provider_name: str
    endpoint_url: str = ""
    sender_identifier: str = ""
    is_enabled: bool = False
    has_credentials: bool = False
    min_priority: str = "Critical"


@monitoring_router.get("/events/stream")
async def sse_events_stream(request: Request, current_user: User = Depends(get_current_user)):
    async def event_generator():
        yield f"event: connected\ndata: {json.dumps({'server_time': datetime.now(timezone.utc).isoformat()})}\n\n"
        while not await request.is_disconnected():
            await asyncio.sleep(15)
            yield f"event: heartbeat\ndata: {json.dumps({'server_time': datetime.now(timezone.utc).isoformat()})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@monitoring_router.get("/monitoring-thresholds")
def get_thresholds(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cfg = db.query(PerformanceThresholdConfig).first()
    return cfg


@monitoring_router.post("/monitoring-thresholds")
def update_thresholds(
    body: ThresholdUpdateRequest,
    current_user: User = Depends(require_roles([RoleCode.REGIONAL_ADMIN, RoleCode.REGIONAL_COORDINATION])),
    db: Session = Depends(get_db),
):
    campaign = db.query(Campaign).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="No campaign configured.")
    cfg = db.query(PerformanceThresholdConfig).filter(PerformanceThresholdConfig.campaign_id == campaign.id).first()
    if not cfg:
        cfg = PerformanceThresholdConfig(campaign_id=campaign.id)
        db.add(cfg)
    cfg.is_configured = any(
        v is not None
        for v in [
            body.high_coverage_min_pct,
            body.medium_coverage_min_pct,
            body.high_completeness_min_pct,
            body.high_wastage_alert_pct,
        ]
    )
    cfg.high_coverage_min_pct = body.high_coverage_min_pct
    cfg.medium_coverage_min_pct = body.medium_coverage_min_pct
    cfg.high_completeness_min_pct = body.high_completeness_min_pct
    cfg.high_wastage_alert_pct = body.high_wastage_alert_pct
    cfg.late_report_cutoff_hour_utc = body.late_report_cutoff_hour_utc
    cfg.declining_performance_drop_pct = body.declining_performance_drop_pct
    cfg.notes = body.notes
    cfg.updated_by_id = current_user.id
    db.commit()
    db.refresh(cfg)
    return cfg


@monitoring_router.get("/gis/layers")
def list_gis_layers(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(GisBoundaryLayer).order_by(GisBoundaryLayer.created_at.desc()).all()


@monitoring_router.post("/gis/layers", status_code=status.HTTP_201_CREATED)
def upload_gis_layer(
    body: GisLayerUploadRequest,
    current_user: User = Depends(require_roles([RoleCode.REGIONAL_ADMIN, RoleCode.REGIONAL_COORDINATION])),
    db: Session = Depends(get_db),
):
    if body.geojson.get("type") != "FeatureCollection" or not isinstance(body.geojson.get("features"), list):
        raise HTTPException(status_code=400, detail="GeoJSON must be a valid FeatureCollection.")
    layer = GisBoundaryLayer(
        name=body.name.strip(),
        admin_level=body.admin_level,
        source_citation=body.source_citation.strip(),
        feature_count=len(body.geojson["features"]),
        matched_units_count=0,
        geojson=body.geojson,
        uploaded_by_id=current_user.id,
    )
    db.add(layer)
    db.commit()
    db.refresh(layer)
    return layer


@monitoring_router.get("/alerts")
def list_alerts(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(CampaignAlert).order_by(CampaignAlert.detected_at.desc()).all()


@monitoring_router.post("/alerts/{alert_id}/acknowledge")
def acknowledge_alert(
    alert_id: UUID,
    current_user: User = Depends(require_roles([RoleCode.REGIONAL_ADMIN, RoleCode.REGIONAL_COORDINATION, RoleCode.ZONE_ADMIN, RoleCode.WOREDA_OFFICER])),
    db: Session = Depends(get_db),
):
    alert = db.query(CampaignAlert).filter(CampaignAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found.")
    alert.resolution_status = "Acknowledged"
    alert.acknowledged_by_id = current_user.id
    alert.acknowledged_at = datetime.now(timezone.utc)
    db.commit()
    return alert


@monitoring_router.post("/alerts/{alert_id}/resolve")
def resolve_alert(
    alert_id: UUID,
    body: AlertActionRequest,
    current_user: User = Depends(require_roles([RoleCode.REGIONAL_ADMIN, RoleCode.REGIONAL_COORDINATION, RoleCode.ZONE_ADMIN])),
    db: Session = Depends(get_db),
):
    alert = db.query(CampaignAlert).filter(CampaignAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found.")
    if not body.resolution_notes or not body.resolution_notes.strip():
        raise HTTPException(status_code=400, detail="Resolution notes are required.")
    alert.resolution_status = "Resolved"
    alert.resolution_notes = body.resolution_notes.strip()
    alert.resolved_by_id = current_user.id
    alert.resolved_at = datetime.now(timezone.utc)
    db.commit()
    return alert


@monitoring_router.get("/notifications/providers")
def list_providers(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return {
        "providers": db.query(NotificationProviderConfig).all(),
        "dispatch_logs": db.query(NotificationDispatchLog).order_by(NotificationDispatchLog.created_at.desc()).limit(100).all(),
    }


@monitoring_router.patch("/notifications/providers/{channel}")
def update_provider(
    channel: str,
    body: ProviderConfigUpdateRequest,
    current_user: User = Depends(require_roles([RoleCode.REGIONAL_ADMIN])),
    db: Session = Depends(get_db),
):
    cfg = db.query(NotificationProviderConfig).filter(NotificationProviderConfig.channel == channel).first()
    if not cfg:
        cfg = NotificationProviderConfig(channel=channel, provider_name=body.provider_name)
        db.add(cfg)
    cfg.provider_name = body.provider_name
    cfg.endpoint_url = body.endpoint_url
    cfg.sender_identifier = body.sender_identifier
    cfg.is_enabled = body.is_enabled
    cfg.has_credentials = body.has_credentials
    cfg.min_priority = body.min_priority
    cfg.updated_by_id = current_user.id
    db.commit()
    return cfg
