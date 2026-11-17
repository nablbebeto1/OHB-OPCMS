import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def utcnow():
    return datetime.now(timezone.utc)


class Region(Base):
    __tablename__ = "regions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    zones = relationship("Zone", back_populates="region", cascade="all, delete-orphan")


class Zone(Base):
    __tablename__ = "zones"
    __table_args__ = (UniqueConstraint("region_id", "normalized_name", name="uq_zones_region_norm_name"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    region_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("regions.id", ondelete="RESTRICT"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(160), nullable=False)
    zone_type: Mapped[str] = mapped_column(String(32), default="Zone", nullable=False)  # Zone, Town, City
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    region = relationship("Region", back_populates="zones")
    woredas = relationship("Woreda", back_populates="zone", cascade="all, delete-orphan")


class Woreda(Base):
    __tablename__ = "woredas"
    __table_args__ = (UniqueConstraint("zone_id", "reporting_unit_code", name="uq_woredas_zone_unit_code"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    zone_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("zones.id", ondelete="RESTRICT"), nullable=False, index=True)
    reporting_unit_code: Mapped[str] = mapped_column(String(64), nullable=False)
    source_sn: Mapped[int | None] = mapped_column(Integer, nullable=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    raw_excel_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    is_duplicate_in_template: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    has_security_constraints: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    zone = relationship("Zone", back_populates="woredas")
    targets = relationship("AdministrativeTarget", back_populates="woreda")
    reports = relationship("DailyVaccinationReport", back_populates="woreda")
    security_settlements = relationship("SecurityAffectedSettlement", back_populates="woreda")
