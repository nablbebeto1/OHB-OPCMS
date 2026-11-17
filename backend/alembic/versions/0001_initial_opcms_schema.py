"""Initial OPCMS PostgreSQL schema

Revision ID: 0001_initial_opcms
Revises:
Create Date: 2026-11-17 08:00:00.000000
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial_opcms"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "regions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(32), nullable=False, unique=True),
        sa.Column("name", sa.String(120), nullable=False, unique=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "zones",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("region_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("regions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("code", sa.String(64), nullable=False, unique=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("normalized_name", sa.String(160), nullable=False),
        sa.Column("zone_type", sa.String(32), nullable=False, server_default="Zone"),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("region_id", "normalized_name", name="uq_zones_region_norm_name"),
    )
    op.create_index("ix_zones_region_id", "zones", ["region_id"])

    op.create_table(
        "woredas",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("zone_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("zones.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("reporting_unit_code", sa.String(64), nullable=False),
        sa.Column("source_sn", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("raw_excel_name", sa.String(180), nullable=True),
        sa.Column("is_duplicate_in_template", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("has_security_constraints", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("zone_id", "reporting_unit_code", name="uq_woredas_zone_unit_code"),
    )
    op.create_index("ix_woredas_zone_id", "woredas", ["zone_id"])

    op.create_table(
        "roles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(64), nullable=False, unique=True),
        sa.Column("name", sa.String(120), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_read_only", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "permissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(96), nullable=False, unique=True),
        sa.Column("module", sa.String(64), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
    )

    op.create_table(
        "role_permissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("role_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("roles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("permission_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("permissions.id", ondelete="CASCADE"), nullable=False),
        sa.UniqueConstraint("role_id", "permission_id", name="uq_role_permission"),
    )

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("username", sa.String(80), nullable=False, unique=True),
        sa.Column("email", sa.String(160), nullable=False, unique=True),
        sa.Column("full_name", sa.String(160), nullable=False),
        sa.Column("phone", sa.String(32), nullable=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("region_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("regions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("zone_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("zones.id", ondelete="SET NULL"), nullable=True),
        sa.Column("woreda_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("woredas.id", ondelete="SET NULL"), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_users_username", "users", ["username"])

    op.create_table(
        "campaigns",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(64), nullable=False, unique=True),
        sa.Column("name", sa.String(220), nullable=False),
        sa.Column("round_number", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("vaccine_types", sa.String(120), nullable=False),
        sa.Column("nopv2_doses_per_vial", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("bopv_doses_per_vial", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("core_target_days_divisor", sa.Integer(), nullable=False, server_default="4"),
        sa.Column("total_campaign_days", sa.Integer(), nullable=False, server_default="6"),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="Active"),
        sa.Column("region_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("regions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "campaign_days",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day_number", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(64), nullable=False),
        sa.Column("worksheet_name", sa.String(64), nullable=False),
        sa.Column("day_type", sa.String(32), nullable=False, server_default="Core"),
        sa.Column("campaign_date", sa.Date(), nullable=False),
        sa.Column("is_open_for_reporting", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("campaign_id", "day_number", name="uq_campaign_day_number"),
    )

    op.create_table(
        "administrative_targets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("woreda_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("woredas.id", ondelete="CASCADE"), nullable=False),
        sa.Column("total_planned_target", sa.Integer(), nullable=False),
        sa.Column("daily_target", sa.Integer(), nullable=False),
        sa.Column("target_0_11m", sa.Integer(), nullable=True),
        sa.Column("target_12_59m", sa.Integer(), nullable=True),
        sa.Column("target_60_120m", sa.Integer(), nullable=True),
        sa.Column("source_reference", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("campaign_id", "woreda_id", name="uq_target_campaign_woreda"),
        sa.CheckConstraint("total_planned_target >= 0", name="ck_target_planned_nonneg"),
        sa.CheckConstraint("daily_target >= 0", name="ck_target_daily_nonneg"),
    )

    op.create_table(
        "security_affected_settlements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("woreda_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("woredas.id", ondelete="CASCADE"), nullable=False),
        sa.Column("settlement_name", sa.String(180), nullable=False),
        sa.Column("kebele_name", sa.String(180), nullable=True),
        sa.Column("access_status", sa.String(48), nullable=False, server_default="Partially Accessible"),
        sa.Column("intervention_modality", sa.String(120), nullable=True),
        sa.Column("target_children_0_59m", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("vaccinated_children_0_59m", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("security_notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "daily_vaccination_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("campaign_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("campaign_day_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("campaign_days.id", ondelete="CASCADE"), nullable=False),
        sa.Column("woreda_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("woredas.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="Draft"),
        sa.Column("is_locked", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("total_vaccinated_0_59m", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_vaccinated_60_120m", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("daily_coverage_pct", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("cumulative_coverage_pct", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("any_remark", sa.Text(), nullable=True),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("submitted_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("reviewed_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("approved_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("campaign_day_id", "woreda_id", name="uq_report_day_woreda"),
        sa.CheckConstraint(
            "status IN ('Draft', 'Submitted', 'Under Review', 'Approved', 'Returned for Correction')",
            name="ck_report_valid_status",
        ),
    )

    op.create_table(
        "age_group_vaccination_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("daily_vaccination_reports.id", ondelete="CASCADE"), nullable=False),
        sa.Column("age_group", sa.String(16), nullable=False),
        sa.Column("vaccinated_before", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("not_vaccinated_before", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("report_id", "age_group", name="uq_age_record_report_group"),
        sa.CheckConstraint("age_group IN ('0-11m', '12-59m', '60-120m')", name="ck_valid_age_group"),
    )

    op.create_table(
        "vaccine_utilization_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("daily_vaccination_reports.id", ondelete="CASCADE"), nullable=False),
        sa.Column("vaccine_type", sa.String(16), nullable=False),
        sa.Column("vials_received", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("vials_used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("vials_partially_used", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("vials_returned_unused_good", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("vials_broken", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("vials_returned_bad_stage_3_4", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("vials_lost", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("wastage_rate_pct", sa.Float(), nullable=False, server_default="0.0"),
        sa.UniqueConstraint("report_id", "vaccine_type", name="uq_vaccine_record_report_type"),
        sa.CheckConstraint("vaccine_type IN ('nOPV2', 'bOPV')", name="ck_valid_vaccine_type"),
    )

    op.create_table(
        "afp_aefi_alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("daily_vaccination_reports.id", ondelete="CASCADE"), nullable=False),
        sa.Column("afp_alerts_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("aefi_alerts_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("investigation_notes", sa.Text(), nullable=True),
    )

    op.create_table(
        "social_mobilization_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("daily_vaccination_reports.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("hhs_visited", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("community_meeting_participants", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("home_to_home_ipc_reached", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "zero_dose_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("daily_vaccination_reports.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("identified_and_linked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("vaccinated", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "under_vaccinated_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("daily_vaccination_reports.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("identified_and_linked", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("vaccinated", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "vaccination_teams",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("daily_vaccination_reports.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("total_teams", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("teams_reported", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "report_submission_histories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("report_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("daily_vaccination_reports.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_status", sa.String(32), nullable=True),
        sa.Column("to_status", sa.String(32), nullable=False),
        sa.Column("action", sa.String(48), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "notifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("recipient_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("recipient_role_code", sa.String(64), nullable=True),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("severity", sa.String(24), nullable=False, server_default="info"),
        sa.Column("related_entity_type", sa.String(64), nullable=True),
        sa.Column("related_entity_id", sa.String(64), nullable=True),
        sa.Column("is_read", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("actor_username", sa.String(80), nullable=False),
        sa.Column("actor_role", sa.String(64), nullable=False),
        sa.Column("action", sa.String(80), nullable=False),
        sa.Column("entity_type", sa.String(64), nullable=False),
        sa.Column("entity_id", sa.String(64), nullable=False),
        sa.Column("details", postgresql.JSON(astext_type=sa.Text()), nullable=True),
        sa.Column("ip_address", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "excel_import_histories",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("worksheet_names", postgresql.JSON(astext_type=sa.Text()), nullable=False),
        sa.Column("rows_processed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("discrepancies_detected", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("imported_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.String(32), nullable=False, server_default="Audited"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "formula_discrepancies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("import_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("excel_import_histories.id", ondelete="CASCADE"), nullable=False),
        sa.Column("worksheet", sa.String(64), nullable=False),
        sa.Column("cell_or_column", sa.String(120), nullable=False),
        sa.Column("severity", sa.String(24), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("observed_value", sa.Text(), nullable=False),
        sa.Column("expected_value", sa.Text(), nullable=False),
        sa.Column("recommendation", sa.Text(), nullable=False),
        sa.Column("ohb_approval_status", sa.String(32), nullable=False, server_default="Pending OHB Review"),
        sa.Column("approved_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("resolution_notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade() -> None:
    for table in [
        "formula_discrepancies",
        "excel_import_histories",
        "audit_logs",
        "notifications",
        "report_submission_histories",
        "vaccination_teams",
        "under_vaccinated_records",
        "zero_dose_records",
        "social_mobilization_records",
        "afp_aefi_alerts",
        "vaccine_utilization_records",
        "age_group_vaccination_records",
        "daily_vaccination_reports",
        "security_affected_settlements",
        "administrative_targets",
        "campaign_days",
        "campaigns",
        "users",
        "role_permissions",
        "permissions",
        "roles",
        "woredas",
        "zones",
        "regions",
    ]:
        op.drop_table(table)
