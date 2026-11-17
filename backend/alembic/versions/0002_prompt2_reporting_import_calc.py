"""Prompt 2 schema extensions: CalculationConfig, SecurityDailyReport, separate ZeroDose/UnderVaccinated fields

Revision ID: 0002_prompt2_reporting_import_calc
Revises: 0001_initial_opcms
Create Date: 2026-11-17 09:00:00.000000
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0002_prompt2_reporting_import_calc"
down_revision: Union[str, None] = "0001_initial_opcms"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("daily_vaccination_reports", sa.Column("reporting_level", sa.String(24), nullable=False, server_default="Woreda"))
    op.alter_column("daily_vaccination_reports", "daily_coverage_pct", nullable=True)
    op.alter_column("daily_vaccination_reports", "cumulative_coverage_pct", nullable=True)
    op.alter_column("vaccine_utilization_records", "wastage_rate_pct", nullable=True)

    op.add_column("zero_dose_records", sa.Column("identified", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("zero_dose_records", sa.Column("linked", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("under_vaccinated_records", sa.Column("identified", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("under_vaccinated_records", sa.Column("linked", sa.Integer(), nullable=False, server_default="0"))

    op.add_column("security_affected_settlements", sa.Column("daily_target_0_59m", sa.Integer(), nullable=False, server_default="0"))

    op.create_table(
        "security_daily_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("campaign_day_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("campaign_days.id", ondelete="CASCADE"), nullable=False),
        sa.Column("settlement_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("security_affected_settlements.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vaccinated_0_11m", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("vaccinated_12_59m", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("vaccinated_60_120m", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_vaccinated_0_59m", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("teams_deployed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(32), nullable=False, server_default="Draft"),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("reported_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("campaign_day_id", "settlement_id", name="uq_sec_report_day_settlement"),
    )

    op.create_table(
        "calculation_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.String(32), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("daily_target_divisor", sa.Integer(), nullable=False, server_default="4"),
        sa.Column("nopv2_doses_per_vial_default", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("bopv_doses_per_vial_default", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("wastage_denominator_mode", sa.String(48), nullable=False, server_default="used_plus_partial"),
        sa.Column("total_vaccinated_scope", sa.String(32), nullable=False, server_default="0-59m_only"),
        sa.Column("documented_definition", sa.Text(), nullable=False),
        sa.Column("approval_status", sa.String(32), nullable=False, server_default="Pending Approval"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("approved_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("calculation_configs")
    op.drop_table("security_daily_reports")
    op.drop_column("security_affected_settlements", "daily_target_0_59m")
    op.drop_column("under_vaccinated_records", "linked")
    op.drop_column("under_vaccinated_records", "identified")
    op.drop_column("zero_dose_records", "linked")
    op.drop_column("zero_dose_records", "identified")
    op.drop_column("daily_vaccination_reports", "reporting_level")
