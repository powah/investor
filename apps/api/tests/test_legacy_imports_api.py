from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.legacy_imports import router
from app.api.routes import router as trading_router
from app.core.database import Base, get_db
from app.models.legacy_imports import LegacyImport


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(engine)

    def override_get_db():
        with testing_session() as db:
            yield db

    app = FastAPI()
    app.include_router(trading_router)
    app.include_router(router)
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        test_client.app.state.testing_session = testing_session
        yield test_client


def add_legacy_import(client: TestClient, **overrides) -> None:
    values = {
        "source_scanner_symbol_id": 41,
        "ticker": "KEEP",
        "price": 2.35,
        "gap_pct": 42.0,
        "rel_volume": 18.4,
        "float_m": 8.2,
        "market_cap_m": 21.0,
        "spread_pct": 0.9,
        "catalyst_type": "FDA",
        "above_vwap": True,
        "news_headline": "Known headline",
        "clean_daily_chart_room": True,
        "holding_key_level": False,
        "no_dilution_red_flag": True,
        "status": "watch",
        "data_origin": "manual_import",
        "original_created_at": datetime(2026, 7, 31, 10, 0, tzinfo=timezone.utc),
        "original_updated_at": datetime(2026, 7, 31, 10, 5, tzinfo=timezone.utc),
        "source_provenance": None,
        "trading_date": None,
        "market_phase": None,
        "source_timestamp": None,
    }
    values.update(overrides)
    with client.app.state.testing_session() as db:
        db.add(LegacyImport(**values))
        db.commit()


def test_demo_legacy_imports_require_an_explicit_demo_context(client: TestClient):
    add_legacy_import(client, source_scanner_symbol_id=42, ticker="DEMO", data_origin="demo")

    assert client.get("/legacy-imports").json() == []

    response = client.get("/legacy-imports", params={"context": "demo"})

    assert response.status_code == 200
    assert [(row["ticker"], row["label"], row["actionable"]) for row in response.json()] == [
        ("DEMO", "Legacy Import", False)
    ]


def test_operational_legacy_imports_are_inspectable_but_not_actionable(client: TestClient):
    add_legacy_import(client)

    response = client.get("/legacy-imports")

    assert response.status_code == 200
    assert response.json() == [
        {
            "id": 1,
            "label": "Legacy Import",
            "reference_only": True,
            "actionable": False,
            "ticker": "KEEP",
            "price": 2.35,
            "gap_pct": 42.0,
            "rel_volume": 18.4,
            "float_m": 8.2,
            "market_cap_m": 21.0,
            "spread_pct": 0.9,
            "catalyst_type": "FDA",
            "above_vwap": True,
            "news_headline": "Known headline",
            "clean_daily_chart_room": True,
            "holding_key_level": False,
            "no_dilution_red_flag": True,
            "legacy_status": "watch",
            "data_origin": "manual_import",
            "original_created_at": "2026-07-31T10:00:00",
            "original_updated_at": "2026-07-31T10:05:00",
            "source_provenance": None,
            "trading_date": None,
            "market_phase": None,
            "source_timestamp": None,
        }
    ]
    assert client.get("/scanner").json() == []
    assert client.patch("/scanner/KEEP/status", json={"status": "watch"}).status_code == 404
