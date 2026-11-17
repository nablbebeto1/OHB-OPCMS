import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


def utcnow():
    return datetime.now(timezone.utc)


class CampaignAlert(Base):
    __tablename__ = "campaign_alerts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    fingerprint: Mapped[str] = mapped_column(String(160), unique=True, nullable=False, index=True)
    priority: Mapped[str] = mapped_column(String(24), nullable=False, index=True)  # Critical, High, Medium, Low
    alert_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    admin_location: Mapped[str] = mapped_column(String(160), nullable=False)
    zone_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("zones.id", ondelete="SET NULL"), nullable=True)
    woreda_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("woredas.id", ondelete="SET NULL"), nullable=True)
    settlement_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("security_affected_settlements.id", ondelete="SET NULL"), nullable=True)
    campaign_day_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("campaign_days.id", ondelete="SET NULL"), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    responsible_officer: Mapped[str] = mapped_column(String(140), default="Unassigned", nullable=False)
    resolution_status: Mapped[str] = mapped_column(String(24), default="Open", nullable=False, index=True)  # Open, Acknowledged, Resolved
    resolution_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    acknowledged_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class PerformanceThresholdConfig(Base):
    __tablename__ = "performance_threshold_configs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True)
    is_configured: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    high_coverage_min_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    medium_coverage_min_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    high_completeness_min_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    high_wastage_alert_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    late_report_cutoff_hour_utc: Mapped[int | None] = mapped_column(Integer, nullable=True)
    declining_performance_drop_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class GisBoundaryLayer(Base):
    __tablename__ = "gis_boundary_layers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    admin_level: Mapped[str] = mapped_column(String(24), nullable=False)  # Region, Zone, Woreda, Settlement
    source_citation: Mapped[str] = mapped_column(String(255), nullable=False)
    feature_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    matched_units_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    geojson: Mapped[dict] = mapped_column(JSON, nullable=False)
    uploaded_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class NotificationProviderConfig(Base):
    __tablename__ = "notification_provider_configs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    channel: Mapped[str] = mapped_column(String(16), unique=True, nullable=False)  # Email, SMS
    provider_name: Mapped[str] = mapped_column(String(80), nullable=False)
    endpoint_url: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    sender_identifier: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    has_credentials: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    min_priority: Mapped[str] = mapped_column(String(24), default="Critical", nullable=False)
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class NotificationDispatchLog(Base):
    __tablename__ = "notification_dispatch_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    alert_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaign_alerts.id", ondelete="CASCADE"), nullable=False, index=True)
    channel: Mapped[str] = mapped_column(String(16), nullable=False)
    recipient: Mapped[str] = mapped_column(String(140), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)  # Dispatched, Not Configured, Delivery Failed
    detail: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class CommandDisplaySession(Base):
    __tablename__ = "command_display_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    token_prefix: Mapped[str] = mapped_column(String(32), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    default_layout: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    rotation_seconds: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    last_accessed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

