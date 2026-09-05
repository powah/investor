"""add stable security identity and candidate admission

Revision ID: d7e3a91b4f20
Revises: c4a9f2e8d1b6
Create Date: 2026-09-02
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "d7e3a91b4f20"
down_revision: str | Sequence[str] | None = "c4a9f2e8d1b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "securities",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("identifier_source", sa.String(length=80), nullable=False),
        sa.Column("identifier", sa.String(length=160), nullable=False),
        sa.Column("issuer_name", sa.String(length=240), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("identifier_source", "identifier", name="uq_securities_stable_identity"),
    )
    op.create_table(
        "listings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("security_id", sa.Integer(), nullable=False),
        sa.Column("ticker", sa.String(length=24), nullable=False),
        sa.Column("exchange", sa.String(length=40), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=True),
        sa.Column("instrument_type", sa.String(length=80), nullable=True),
        sa.Column("effective_from", sa.Date(), nullable=True),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("foreign_issuer", sa.Boolean(), nullable=True),
        sa.Column("depositary_to_underlying_ratio", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["security_id"], ["securities.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "security_id", "ticker", "exchange", "effective_from",
            name="uq_listings_effective_identity",
        ),
    )
    op.create_index("ix_listings_security_id", "listings", ["security_id"])
    op.create_index("ix_listings_ticker", "listings", ["ticker"])
    op.create_table(
        "scanner_session_candidates",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("scanner_session_id", sa.Integer(), nullable=False),
        sa.Column("security_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["scanner_session_id"], ["scanner_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["security_id"], ["securities.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("scanner_session_id", "security_id", name="uq_candidates_session_security"),
    )
    op.create_index(
        "ix_scanner_session_candidates_scanner_session_id",
        "scanner_session_candidates",
        ["scanner_session_id"],
    )
    op.create_table(
        "discovery_hits",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("scanner_session_id", sa.Integer(), nullable=False),
        sa.Column("security_id", sa.Integer(), nullable=True),
        sa.Column("listing_id", sa.Integer(), nullable=True),
        sa.Column("candidate_id", sa.Integer(), nullable=True),
        sa.Column("source", sa.String(length=80), nullable=False),
        sa.Column("source_reference", sa.String(length=500), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ticker", sa.String(length=24), nullable=False),
        sa.Column("observed_exchange", sa.String(length=40), nullable=True),
        sa.Column("observed_listing_status", sa.String(length=40), nullable=True),
        sa.Column("observed_instrument_type", sa.String(length=80), nullable=True),
        sa.Column("observed_effective_from", sa.Date(), nullable=True),
        sa.Column("observed_effective_to", sa.Date(), nullable=True),
        sa.Column("observed_foreign_issuer", sa.Boolean(), nullable=True),
        sa.Column("observed_depositary_to_underlying_ratio", sa.Float(), nullable=True),
        sa.Column("discovery_reason", sa.Text(), nullable=False),
        sa.Column("admission_outcome", sa.String(length=20), nullable=False),
        sa.Column("admission_reasons", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["scanner_session_id"], ["scanner_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["security_id"], ["securities.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["listing_id"], ["listings.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["candidate_id"], ["scanner_session_candidates.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_discovery_hits_scanner_session_id", "discovery_hits", ["scanner_session_id"])
    op.create_index("ix_discovery_hits_security_id", "discovery_hits", ["security_id"])
    op.create_index("ix_discovery_hits_candidate_id", "discovery_hits", ["candidate_id"])


def downgrade() -> None:
    op.drop_index("ix_discovery_hits_candidate_id", table_name="discovery_hits")
    op.drop_index("ix_discovery_hits_security_id", table_name="discovery_hits")
    op.drop_index("ix_discovery_hits_scanner_session_id", table_name="discovery_hits")
    op.drop_table("discovery_hits")
    op.drop_index(
        "ix_scanner_session_candidates_scanner_session_id",
        table_name="scanner_session_candidates",
    )
    op.drop_table("scanner_session_candidates")
    op.drop_index("ix_listings_ticker", table_name="listings")
    op.drop_index("ix_listings_security_id", table_name="listings")
    op.drop_table("listings")
    op.drop_table("securities")
