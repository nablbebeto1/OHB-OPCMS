import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, CheckConstraint, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def utcnow():
    return datetime.now(timezone.utc)


class DailyVaccinationReport(Base):
    __tablename__ = "daily_vaccination_reports"
    __table_args__ = (
        UniqueConstraint("campaign_day_id", "woreda_id", name="uq_report_day_woreda"),
        CheckConstraint(
            "status IN ('Draft', 'Submitted', 'Under Review', 'Approved', 'Returned for Correction')",
            name="ck_report_valid_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True)
    campaign_day_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaign_days.id", ondelete="CASCADE"), nullable=False, index=True)
    woreda_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("woredas.id", ondelete="CASCADE"), nullable=False, index=True)
    reporting_level: Mapped[str] = mapped_column(String(24), default="Woreda", nullable=False)  # Woreda, Zone, Region
    status: Mapped[str] = mapped_column(String(32), default="Draft", nullable=False, index=True)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    total_vaccinated_0_59m: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_vaccinated_60_120m: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    daily_coverage_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    cumulative_coverage_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    any_remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_report_id: Mapped[str | None] = mapped_column(String(80), nullable=True, unique=True, index=True)
    server_received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    submitted_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_by_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    campaign_day = relationship("CampaignDay", back_populates="reports")
    woreda = relationship("Woreda", back_populates="reports")
    age_groups = relationship("AgeGroupVaccinationRecord", back_populates="report", cascade="all, delete-orphan")
    vaccine_utilizations = relationship("VaccineUtilizationRecord", back_populates="report", cascade="all, delete-orphan")
    alerts = relationship("AfpAefiAlert", back_populates="report", cascade="all, delete-orphan")
    social_mobilization = relationship("SocialMobilizationRecord", back_populates="report", uselist=False, cascade="all, delete-orphan")
    zero_dose = relationship("ZeroDoseRecord", back_populates="report", uselist=False, cascade="all, delete-orphan")
    under_vaccinated = relationship("UnderVaccinatedRecord", back_populates="report", uselist=False, cascade="all, delete-orphan")
    vaccination_teams = relationship("VaccinationTeam", back_populates="report", uselist=False, cascade="all, delete-orphan")
    histories = relationship("ReportSubmissionHistory", back_populates="report", cascade="all, delete-orphan")


class AgeGroupVaccinationRecord(Base):
    __tablename__ = "age_group_vaccination_records"
    __table_args__ = (
        UniqueConstraint("report_id", "age_group", name="uq_age_record_report_group"),
        CheckConstraint("age_group IN ('0-11m', '12-59m', '60-120m')", name="ck_valid_age_group"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("daily_vaccination_reports.id", ondelete="CASCADE"), nullable=False, index=True)
    age_group: Mapped[str] = mapped_column(String(16), nullable=False)
    vaccinated_before: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    not_vaccinated_before: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    report = relationship("DailyVaccinationReport", back_populates="age_groups")


class VaccineUtilizationRecord(Base):
    __tablename__ = "vaccine_utilization_records"
    __table_args__ = (
        UniqueConstraint("report_id", "vaccine_type", name="uq_vaccine_record_report_type"),
        CheckConstraint("vaccine_type IN ('nOPV2', 'bOPV')", name="ck_valid_vaccine_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("daily_vaccination_reports.id", ondelete="CASCADE"), nullable=False, index=True)
    vaccine_type: Mapped[str] = mapped_column(String(16), nullable=False)
    vials_received: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    vials_used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    vials_partially_used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    vials_returned_unused_good: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    vials_broken: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    vials_returned_bad_stage_3_4: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    vials_lost: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    wastage_rate_pct: Mapped[float | None] = mapped_column(Float, nullable=True)

    report = relationship("DailyVaccinationReport", back_populates="vaccine_utilizations")


class AfpAefiAlert(Base):
    __tablename__ = "afp_aefi_alerts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("daily_vaccination_reports.id", ondelete="CASCADE"), nullable=False, index=True)
    afp_alerts_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    aefi_alerts_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    investigation_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    report = relationship("DailyVaccinationReport", back_populates="alerts")


class SocialMobilizationRecord(Base):
    __tablename__ = "social_mobilization_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("daily_vaccination_reports.id", ondelete="CASCADE"), unique=True, nullable=False)
    hhs_visited: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    community_meeting_participants: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    home_to_home_ipc_reached: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    report = relationship("DailyVaccinationReport", back_populates="social_mobilization")


class ZeroDoseRecord(Base):
    __tablename__ = "zero_dose_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("daily_vaccination_reports.id", ondelete="CASCADE"), unique=True, nullable=False)
    identified: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    linked: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    identified_and_linked: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    vaccinated: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    report = relationship("DailyVaccinationReport", back_populates="zero_dose")


class UnderVaccinatedRecord(Base):
    __tablename__ = "under_vaccinated_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("daily_vaccination_reports.id", ondelete="CASCADE"), unique=True, nullable=False)
    identified: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    linked: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    identified_and_linked: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    vaccinated: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    report = relationship("DailyVaccinationReport", back_populates="under_vaccinated")


class VaccinationTeam(Base):
    __tablename__ = "vaccination_teams"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("daily_vaccination_reports.id", ondelete="CASCADE"), unique=True, nullable=False)
    total_teams: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    teams_reported: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    report = relationship("DailyVaccinationReport", back_populates="vaccination_teams")
