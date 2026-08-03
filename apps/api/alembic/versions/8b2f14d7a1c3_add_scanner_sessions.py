"""add scanner sessions

Revision ID: 8b2f14d7a1c3
Revises: 3a7a2c3f0c0c
Create Date: 2026-08-02
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "8b2f14d7a1c3"
down_revision: str | Sequence[str] | None = "3a7a2c3f0c0c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "scanner_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("stage", sa.String(length=40), nullable=False),
        sa.Column("active_slot", sa.Boolean(), nullable=True),
        sa.Column("owner_id", sa.String(length=32), nullable=False),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trading_date", sa.Date(), nullable=False),
        sa.Column("market_phase", sa.String(length=20), nullable=False),
        sa.Column("scanner_policy_version", sa.String(length=80), nullable=False),
        sa.Column("scanner_policy_settings", sa.JSON(), nullable=False),
        sa.Column("scoring_model_version", sa.String(length=80), nullable=False),
        sa.Column("progress_completed", sa.Integer(), nullable=False),
        sa.Column("progress_total", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("active_slot", name="uq_scanner_sessions_active_slot"),
    )
    op.create_index("ix_scanner_sessions_started_at", "scanner_sessions", ["started_at"])
    op.create_index("ix_scanner_sessions_status", "scanner_sessions", ["status"])
    op.create_index("ix_scanner_sessions_trading_date", "scanner_sessions", ["trading_date"])
    op.create_table(
        "scanner_session_diagnostics",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("scanner_session_id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=120), nullable=False),
        sa.Column("capability", sa.String(length=80), nullable=False),
        sa.Column("required", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("records_count", sa.Integer(), nullable=False),
        sa.Column("code", sa.String(length=120), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["scanner_session_id"], ["scanner_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_scanner_session_diagnostics_scanner_session_id",
        "scanner_session_diagnostics",
        ["scanner_session_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_scanner_session_diagnostics_scanner_session_id",
        table_name="scanner_session_diagnostics",
    )
    op.drop_table("scanner_session_diagnostics")
    op.drop_index("ix_scanner_sessions_trading_date", table_name="scanner_sessions")
    op.drop_index("ix_scanner_sessions_status", table_name="scanner_sessions")
    op.drop_index("ix_scanner_sessions_started_at", table_name="scanner_sessions")
    op.drop_table("scanner_sessions")
