"""Prompt 4: Command Room read-only display sessions table

Revision ID: 0004_prompt4_command_room
Revises: 0003_prompt3_monitoring
Create Date: 2026-11-17
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004_prompt4_command_room"
down_revision = "0003_prompt3_monitoring"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "command_display_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("label", sa.String(length=160), nullable=False),
        sa.Column("token_prefix", sa.String(length=32), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False, unique=True),
        sa.Column("default_layout", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("rotation_seconds", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("last_accessed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_command_display_sessions_token_hash", "command_display_sessions", ["token_hash"], unique=True)
    op.create_index("ix_command_display_sessions_is_active", "command_display_sessions", ["is_active"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_command_display_sessions_is_active", table_name="command_display_sessions")
    op.drop_index("ix_command_display_sessions_token_hash", table_name="command_display_sessions")
    op.drop_table("command_display_sessions")
