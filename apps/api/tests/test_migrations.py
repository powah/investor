from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.core.database import Base
import app.models  # noqa: F401


API_ROOT = Path(__file__).resolve().parents[1]


def _config(database_url: str) -> Config:
    config = Config(str(API_ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def test_migrations_build_fresh_schema(tmp_path):
    database_url = f"sqlite+pysqlite:///{tmp_path / 'fresh.sqlite'}"

    command.upgrade(_config(database_url), "head")

    engine = create_engine(database_url)
    inspector = inspect(engine)
    assert "alembic_version" in inspector.get_table_names()
    assert "provider_capability_checks" in inspector.get_table_names()
    assert "scanner_sessions" in inspector.get_table_names()
    assert "scanner_session_diagnostics" in inspector.get_table_names()
    assert "legacy_imports" in inspector.get_table_names()
    assert "data_origin" in {
        column["name"] for column in inspector.get_columns("scanner_symbols")
    }


def test_legacy_import_migration_is_idempotent_and_preserves_only_known_values(tmp_path):
    database_url = f"sqlite+pysqlite:///{tmp_path / 'legacy-imports.sqlite'}"
    config = _config(database_url)
    command.upgrade(config, "8b2f14d7a1c3")
    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO scanner_symbols (
                    id, ticker, price, gap_pct, rel_volume, float_m, market_cap_m,
                    spread_pct, catalyst_type, above_vwap, news_headline,
                    clean_daily_chart_room, holding_key_level, no_dilution_red_flag,
                    status, data_origin, created_at, updated_at
                ) VALUES
                    (41, 'KEEP', 2.35, 42.0, 18.4, 8.2, 21.0, 0.9, 'FDA', 1,
                     'Known headline', 1, 0, 1, 'watch', 'manual_import',
                     '2026-07-31 10:00:00', '2026-07-31 10:05:00'),
                    (42, 'DEMO', 1.25, 10.0, 2.0, 30.0, 40.0, 1.2, NULL, 0,
                     NULL, 0, 0, 0, 'candidate', 'demo',
                     '2026-07-31 11:00:00', '2026-07-31 11:00:00')
                """
            )
        )

    command.upgrade(config, "head")
    command.upgrade(config, "head")

    with engine.connect() as connection:
        imports = connection.execute(
            text(
                """
                SELECT source_scanner_symbol_id, ticker, price, gap_pct, rel_volume,
                       float_m, market_cap_m, spread_pct, catalyst_type, above_vwap,
                       news_headline, clean_daily_chart_room, holding_key_level,
                       no_dilution_red_flag, status, data_origin, original_created_at,
                       original_updated_at, source_provenance, trading_date,
                       market_phase, source_timestamp
                FROM legacy_imports
                ORDER BY source_scanner_symbol_id
                """
            )
        ).mappings().all()
        current_rows = connection.execute(text("SELECT ticker FROM scanner_symbols")).all()

    assert [row["ticker"] for row in imports] == ["KEEP", "DEMO"]
    assert dict(imports[0]) == {
        "source_scanner_symbol_id": 41,
        "ticker": "KEEP",
        "price": 2.35,
        "gap_pct": 42.0,
        "rel_volume": 18.4,
        "float_m": 8.2,
        "market_cap_m": 21.0,
        "spread_pct": 0.9,
        "catalyst_type": "FDA",
        "above_vwap": 1,
        "news_headline": "Known headline",
        "clean_daily_chart_room": 1,
        "holding_key_level": 0,
        "no_dilution_red_flag": 1,
        "status": "watch",
        "data_origin": "manual_import",
        "original_created_at": "2026-07-31 10:00:00",
        "original_updated_at": "2026-07-31 10:05:00",
        "source_provenance": None,
        "trading_date": None,
        "market_phase": None,
        "source_timestamp": None,
    }
    assert current_rows == []


def test_migrations_adopt_the_pre_phase_zero_schema(tmp_path):
    database_url = f"sqlite+pysqlite:///{tmp_path / 'legacy.sqlite'}"
    engine = create_engine(database_url)
    pre_scanner_session_tables = [
        table
        for table in Base.metadata.sorted_tables
        if table.name not in {"legacy_imports", "scanner_sessions", "scanner_session_diagnostics"}
    ]
    Base.metadata.create_all(engine, tables=pre_scanner_session_tables)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE provider_capability_checks"))
        connection.execute(text("DROP INDEX ix_scanner_symbols_data_origin"))
        connection.execute(text("ALTER TABLE scanner_symbols DROP COLUMN data_origin"))

    command.upgrade(_config(database_url), "head")

    inspector = inspect(engine)
    assert "provider_capability_checks" in inspector.get_table_names()
    assert "data_origin" in {
        column["name"] for column in inspector.get_columns("scanner_symbols")
    }
