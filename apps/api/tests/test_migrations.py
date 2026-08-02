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
    assert "data_origin" in {
        column["name"] for column in inspector.get_columns("scanner_symbols")
    }


def test_migrations_adopt_the_pre_phase_zero_schema(tmp_path):
    database_url = f"sqlite+pysqlite:///{tmp_path / 'legacy.sqlite'}"
    engine = create_engine(database_url)
    pre_scanner_session_tables = [
        table
        for table in Base.metadata.sorted_tables
        if table.name not in {"scanner_sessions", "scanner_session_diagnostics"}
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
