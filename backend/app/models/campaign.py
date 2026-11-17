import uuid
from datetime import date, datetime, timezone
from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def utcnow():
    return datetime.now(timezone.utc)


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(220), nullable=False)
    round_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    vaccine_types: Mapped[str] = mapped_column(String(120), default="nOPV2 + bOPV Co-administration", nullable=False)
    nopv2_doses_per_vial: Mapped[int] = mapped_column(Integer, default=50, nullable=False)
    bopv_doses_per_vial: Mapped[int] = mapped_column(Integer, default=20, nullable=False)
    core_target_days_divisor: Mapped[int] = mapped_column(Integer, default=4, nullable=False)
    total_campaign_days: Mapped[int] = mapped_column(Integer, default=6, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="Active", nullable=False)  # Planned, Active, Closed
    region_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("regions.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    days = relationship("CampaignDay", back_populates="campaign", cascade="all, delete-orphan")
    targets = relationship("AdministrativeTarget", back_populates="campaign", cascade="all, delete-orphan")


class CampaignDay(Base):
    __tablename__ = "campaign_days"
    __table_args__ = (UniqueConstraint("campaign_id", "day_number", name="uq_campaign_day_number"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True)
    day_number: Mapped[int] = mapped_column(Integer, nullable=False)
    label: Mapped[str] = mapped_column(String(64), nullable=False)  # Day1 .. Day6
    worksheet_name: Mapped[str] = mapped_column(String(64), nullable=False)
    day_type: Mapped[str] = mapped_column(String(32), default="Core", nullable=False)  # Core (Days 1-4), Mop-Up (Days 5-6)
    campaign_date: Mapped[date] = mapped_column(Date, nullable=False)
    is_open_for_reporting: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    campaign = relationship("Campaign", back_populates="days")
    reports = relationship("DailyVaccinationReport", back_populates="campaign_day")


class AdministrativeTarget(Base):
    __tablename__ = "administrative_targets"
    __table_args__ = (
        UniqueConstraint("campaign_id", "woreda_id", name="uq_target_campaign_woreda"),
        CheckConstraint("total_planned_target >= 0", name="ck_target_planned_nonneg"),
        CheckConstraint("daily_target >= 0", name="ck_target_daily_nonneg"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True)
    woreda_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("woredas.id", ondelete="CASCADE"), nullable=False, index=True)
    total_planned_target: Mapped[int] = mapped_column(Integer, nullable=False)
    daily_target: Mapped[int] = mapped_column(Integer, nullable=False)
    target_0_11m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_12_59m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    target_60_120m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    campaign = relationship("Campaign", back_populates="targets")
    woreda = relationship("Woreda", back_populates="targets")


class SecurityAffectedSettlement(Base):
    __tablename__ = "security_affected_settlements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True)
    woreda_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("woredas.id", ondelete="CASCADE"), nullable=False, index=True)
    settlement_name: Mapped[str] = mapped_column(String(180), nullable=False)
    kebele_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    access_status: Mapped[str] = mapped_column(String(48), default="Partially Accessible", nullable=False)  # Accessible, Partially Accessible, Inaccessible
    intervention_modality: Mapped[str | None] = mapped_column(String(120), nullable=True)  # Hit-and-Run, Transit Point, Local Negotiator
    target_children_0_59m: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    daily_target_0_59m: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    vaccinated_children_0_59m: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    security_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    woreda = relationship("Woreda", back_populates="security_settlements")
    daily_reports = relationship("SecurityDailyReport", back_populates="settlement", cascade="all, delete-orphan")


class SecurityDailyReport(Base):
    __tablename__ = "security_daily_reports"
    __table_args__ = (UniqueConstraint("campaign_day_id", "settlement_id", name="uq_sec_report_day_settlement"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_day_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaign_days.id", ondelete="CASCADE"), nullable=False, index=True)
    settlement_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("security_affected_settlements.id", ondelete="CASCADE"), nullable=False, index=True)
    vaccinated_0_11m: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    vaccinated_12_59m: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    vaccinated_60_120m: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_vaccinated_0_59m: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    teams_deployed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="Draft", nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    reported_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    settlement = relationship("SecurityAffectedSettlement", back_populates="daily_reports")


class CalculationConfig(Base):
    __tablename__ = "calculation_configs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    daily_target_divisor: Mapped[int] = mapped_column(Integer, default=4, nullable=False)
    nopv2_doses_per_vial_default: Mapped[int] = mapped_column(Integer, default=50, nullable=False)
    bopv_doses_per_vial_default: Mapped[int] = mapped_column(Integer, default=20, nullable=False)
    wastage_denominator_mode: Mapped[str] = mapped_column(String(48), default="used_plus_partial", nullable=False)
    total_vaccinated_scope: Mapped[str] = mapped_column(String(32), default="0-59m_only", nullable=False)
    documented_definition: Mapped[str] = mapped_column(Text, nullable=False)
    approval_status: Mapped[str] = mapped_column(String(32), default="Pending Approval", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
