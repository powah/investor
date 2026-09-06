"""add append-only Candidate Evidence and freshness results

Revision ID: f4a7c1e9d2b8
Revises: e91c7a04b532
Create Date: 2026-09-06
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "f4a7c1e9d2b8"
down_revision: str | Sequence[str] | None = "e91c7a04b532"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "candidate_evidence",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("candidate_id", sa.Integer(), nullable=False),
        sa.Column("evidence_type", sa.String(length=80), nullable=False),
        sa.Column("value_state", sa.String(length=24), nullable=False),
        sa.Column("normalized_value", sa.JSON(), nullable=True),
        sa.Column("source_reference", sa.String(length=500), nullable=False),
        sa.Column("event_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("data_tier", sa.String(length=80), nullable=False),
        sa.Column("expected_delay_seconds", sa.Integer(), nullable=True),
        sa.Column("freshness_policy_version", sa.String(length=80), nullable=False),
        sa.Column("freshness_result", sa.String(length=16), nullable=False),
        sa.Column("freshness_reason", sa.String(length=160), nullable=False),
        sa.Column("event_age_seconds", sa.Float(), nullable=True),
        sa.Column("observation_age_seconds", sa.Float(), nullable=True),
        sa.Column("freshness_evaluated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("supersedes_evidence_id", sa.Integer(), nullable=True),
        sa.Column("supersession_type", sa.String(length=24), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "value_state IN ('known', 'unknown', 'verified_negative')",
            name="ck_candidate_evidence_value_state",
        ),
        sa.CheckConstraint(
            "freshness_result IN ('fresh', 'stale', 'unknown')",
            name="ck_candidate_evidence_freshness_result",
        ),
        sa.CheckConstraint(
            "supersession_type IS NULL OR supersession_type IN ('correction', 'new_observation')",
            name="ck_candidate_evidence_supersession_type",
        ),
        sa.ForeignKeyConstraint(
            ["candidate_id"],
            ["scanner_session_candidates.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["supersedes_evidence_id"],
            ["candidate_evidence.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_candidate_evidence_candidate_id",
        "candidate_evidence",
        ["candidate_id"],
    )
    op.create_index(
        "ix_candidate_evidence_evidence_type",
        "candidate_evidence",
        ["evidence_type"],
    )
    op.create_index(
        "ix_candidate_evidence_supersedes_evidence_id",
        "candidate_evidence",
        ["supersedes_evidence_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_candidate_evidence_supersedes_evidence_id",
        table_name="candidate_evidence",
    )
    op.drop_index("ix_candidate_evidence_evidence_type", table_name="candidate_evidence")
    op.drop_index("ix_candidate_evidence_candidate_id", table_name="candidate_evidence")
    op.drop_table("candidate_evidence")
