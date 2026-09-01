"""preserve legacy scanner rows as reference-only imports

Revision ID: c4a9f2e8d1b6
Revises: 8b2f14d7a1c3
Create Date: 2026-09-01
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "c4a9f2e8d1b6"
down_revision: str | Sequence[str] | None = "8b2f14d7a1c3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


LEGACY_VALUE_COLUMNS = (
    "ticker",
    "price",
    "gap_pct",
    "rel_volume",
    "float_m",
    "market_cap_m",
    "spread_pct",
    "catalyst_type",
    "above_vwap",
    "news_headline",
    "clean_daily_chart_room",
    "holding_key_level",
    "no_dilution_red_flag",
    "status",
    "data_origin",
)


def upgrade() -> None:
    op.create_table(
        "legacy_imports",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source_scanner_symbol_id", sa.Integer(), nullable=False),
        sa.Column("ticker", sa.String(length=12), nullable=False),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("gap_pct", sa.Float(), nullable=False),
        sa.Column("rel_volume", sa.Float(), nullable=False),
        sa.Column("float_m", sa.Float(), nullable=False),
        sa.Column("market_cap_m", sa.Float(), nullable=False),
        sa.Column("spread_pct", sa.Float(), nullable=False),
        sa.Column("catalyst_type", sa.String(length=80), nullable=True),
        sa.Column("above_vwap", sa.Boolean(), nullable=False),
        sa.Column("news_headline", sa.Text(), nullable=True),
        sa.Column("clean_daily_chart_room", sa.Boolean(), nullable=False),
        sa.Column("holding_key_level", sa.Boolean(), nullable=False),
        sa.Column("no_dilution_red_flag", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("data_origin", sa.String(length=30), nullable=False),
        sa.Column("original_created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("original_updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source_provenance", sa.String(length=200), nullable=True),
        sa.Column("trading_date", sa.Date(), nullable=True),
        sa.Column("market_phase", sa.String(length=20), nullable=True),
        sa.Column("source_timestamp", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "imported_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "source_scanner_symbol_id",
            name="uq_legacy_imports_source_scanner_symbol_id",
        ),
    )
    op.create_index("ix_legacy_imports_data_origin", "legacy_imports", ["data_origin"])
    op.create_index("ix_legacy_imports_ticker", "legacy_imports", ["ticker"])

    legacy_imports = sa.table(
        "legacy_imports",
        sa.column("source_scanner_symbol_id"),
        *(sa.column(name) for name in LEGACY_VALUE_COLUMNS),
        sa.column("original_created_at"),
        sa.column("original_updated_at"),
        sa.column("source_provenance"),
        sa.column("trading_date"),
        sa.column("market_phase"),
        sa.column("source_timestamp"),
    )
    scanner_symbols = sa.table(
        "scanner_symbols",
        sa.column("id"),
        *(sa.column(name) for name in LEGACY_VALUE_COLUMNS),
        sa.column("created_at"),
        sa.column("updated_at"),
    )
    target_columns = [
        "source_scanner_symbol_id",
        *LEGACY_VALUE_COLUMNS,
        "original_created_at",
        "original_updated_at",
        "source_provenance",
        "trading_date",
        "market_phase",
        "source_timestamp",
    ]
    known_values = [
        scanner_symbols.c.id,
        *(getattr(scanner_symbols.c, name) for name in LEGACY_VALUE_COLUMNS),
        scanner_symbols.c.created_at,
        scanner_symbols.c.updated_at,
        sa.null(),
        sa.null(),
        sa.null(),
        sa.null(),
    ]
    op.execute(legacy_imports.insert().from_select(target_columns, sa.select(*known_values)))
    op.execute(scanner_symbols.delete())


def downgrade() -> None:
    retained_count = op.get_bind().execute(
        sa.text("SELECT count(*) FROM legacy_imports")
    ).scalar_one()
    if retained_count:
        raise RuntimeError(
            "Cannot downgrade: Legacy Imports contain preserved scanner history. "
            "Export or otherwise retain that history before removing this revision."
        )

    op.drop_index("ix_legacy_imports_ticker", table_name="legacy_imports")
    op.drop_index("ix_legacy_imports_data_origin", table_name="legacy_imports")
    op.drop_table("legacy_imports")
