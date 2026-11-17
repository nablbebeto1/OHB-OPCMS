"""Prompt 3: offline sync ids, GIS boundary layers, configurable thresholds, alerts, and notification providers

Revision ID: 0003_prompt3_monitoring
Revises: 0002_prompt2_ext
Create Date: 2026-11-17
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003_prompt3_monitoring"
down_revision = "0002_prompt2_ext"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("daily_vaccination_reports", sa.Column("client_report_id", sa.String(length=80), nullable=True))
    op.add_column("daily_vaccination_reports", sa.Column("server_received_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_daily_vaccination_reports_client_report_id", "daily_vaccination_reports", ["client_report_id"], unique=True)

    op.create_table(
        "campaign_alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("fingerprint", sa.String(length=160), nullable=False, unique=True),
        sa.Column("priority", sa.String(length=24), nullable=False),
        sa.Column("alert_type", sa.String(length=64), nullable=False),
        sa.Column("admin_location", sa.String(length=160), nullable=False),
        sa.Column("zone_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("zones.id", ondelete="SET NULL"), nullable=True),
        sa.Column("woreda_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("woredas.id", ondelete="SET NULL"), nullable=True),
        sa.Column("settlement_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("security_affected_settlements.id", ondelete="SET NULL"), nullable=True),
        sa.Column("campaign_day_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("campaign_days.id", ondelete="SET NULL"), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("responsible_officer", sa.String(length=140), nullable=False, server_default="Unassigned"),
        sa.Column("resolution_status", sa.String(length=24), nullable=False, server_default="Open"),
        sa.Column("resolution_notes", sa.Text(), nullable=True),
        sa.Column("acknowledged_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("detected_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "performance_threshold_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_configured", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("high_coverage_min_pct", sa.Float(), nullable=True),
        sa.Column("medium_coverage_min_pct", sa.Float(), nullable=True),
        sa.Column("high_completeness_min_pct", sa.Float(), nullable=True),
        sa.Column("high_wastage_alert_pct", sa.Float(), nullable=True),
        sa.Column("late_report_cutoff_hour_utc", sa.Integer(), nullable=True),
        sa.Column("declining_performance_drop_pct", sa.Float(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "gis_boundary_layers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("admin_level", sa.String(length=24), nullable=False),
        sa.Column("source_citation", sa.String(length=255), nullable=False),
        sa.Column("feature_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("matched_units_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("geojson", sa.JSON(), nullable=False),
        sa.Column("uploaded_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "notification_provider_configs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("channel", sa.String(length=16), nullable=False, unique=True),
        sa.Column("provider_name", sa.String(length=80), nullable=False),
        sa.Column("endpoint_url", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("sender_identifier", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("is_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("has_credentials", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("min_priority", sa.String(length=24), nullable=False, server_default="Critical"),
        sa.Column("updated_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "notification_dispatch_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("alert_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("campaign_alerts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel", sa.String(length=16), nullable=False),
        sa.Column("recipient", sa.String(length=140), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("notification_dispatch_logs")
    op.drop_table("notification_provider_configs")
    op.drop_table("gis_boundary_layers")
    op.drop_table("performance_threshold_configs")
    op.drop_table("campaign_alerts")
    op.drop_index("ix_daily_vaccination_reports_client_report_id", table_name="daily_vaccination_reports")
    op.drop_column("daily_vaccination_reports", "server_received_at")
    op.drop_column("daily_vaccination_reports", "client_report_id")
