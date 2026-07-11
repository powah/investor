from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.integrations import integration_status, router
from app.core.config import Settings, get_settings
from app.core.database import Base, get_db
from app.models.integrations import ExternalNewsEvent, MarketDataSnapshot
from app.models.trading import Catalyst, ScannerSymbol, TradePlan


def _settings(**overrides) -> Settings:
    values = {
        "database_url": "sqlite+pysqlite:///:memory:",
        "alpaca_api_key_id": "",
        "alpaca_api_secret_key": "",
        "alpaca_trading_base_url": "https://paper-api.alpaca.markets",
        "alpaca_scanner_feed": "delayed_sip",
        "alpaca_execution_feed": "iex",
        "allow_live_trading": False,
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_integration_status_explains_unconfigured_free_sources():
    result = integration_status(_settings())

    assert result.market_data.configured is False
    assert result.market_data.source_feed == "delayed_sip"
    assert result.market_data.is_consolidated is True
    assert result.market_data.real_time is False
    assert result.broker.environment == "paper"
    assert result.broker.enabled is False
    assert "paper credentials" in result.broker.message


def test_iex_is_labeled_realtime_but_not_consolidated():
    result = integration_status(
        _settings(
            alpaca_api_key_id="paper-key",
            alpaca_api_secret_key="paper-secret",
            alpaca_scanner_feed="iex",
        )
    )

    assert result.market_data.enabled is True
    assert result.market_data.real_time is True
    assert result.market_data.is_consolidated is False
    assert "not a consolidated" in result.market_data.message
    assert result.broker.enabled is True


def test_sip_is_unverified_and_disabled_in_the_free_release():
    result = integration_status(
        _settings(
            alpaca_api_key_id="paper-key",
            alpaca_api_secret_key="paper-secret",
            alpaca_scanner_feed="sip",
            alpaca_execution_feed="sip",
        )
    )

    assert result.market_data.enabled is False
    assert result.market_data.environment == "entitlement_unverified"
    assert result.market_data.real_time is False
    assert result.broker.enabled is False
    assert result.broker.environment == "blocked_unverified_sip"


def test_invalid_sec_identity_is_not_reported_as_configured():
    result = integration_status(_settings(sec_user_agent="anonymous-bot"))

    assert result.filings.configured is False
    assert result.filings.enabled is False


def test_live_or_lookalike_broker_url_is_never_enabled():
    for url in (
        "https://api.alpaca.markets",
        "https://paper-api.alpaca.markets.example.com",
    ):
        result = integration_status(
            _settings(
                alpaca_api_key_id="key",
                alpaca_api_secret_key="secret",
                alpaca_trading_base_url=url,
            )
        )
        assert result.broker.enabled is False
        assert result.broker.environment == "blocked_non_paper"


@pytest.fixture
def client_and_session():
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
    app.include_router(router)
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_settings] = lambda: _settings()
    with TestClient(app) as client:
        yield client, testing_session


def test_external_event_requires_explicit_promotion_and_is_idempotent(client_and_session):
    client, testing_session = client_and_session
    with testing_session() as db:
        db.add(ScannerSymbol(ticker="SINT", price=2.35))
        event = ExternalNewsEvent(
            provider="sec_edgar",
            external_id="0000000000-26-000001",
            ticker="SINT",
            source="SEC EDGAR",
            category="8-K",
            headline="SEC 8-K: Current report",
            published_at=datetime.now(timezone.utc),
        )
        db.add(event)
        db.commit()
        db.refresh(event)
        event_id = event.id
        assert db.query(Catalyst).count() == 0

    payload = {"catalyst_type": "Regulatory filing", "quality_score": 12}
    first = client.post(f"/integrations/news-events/{event_id}/promote", json=payload)
    second = client.post(f"/integrations/news-events/{event_id}/promote", json=payload)

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["promoted_catalyst_id"] == second.json()["promoted_catalyst_id"]
    with testing_session() as db:
        assert db.query(Catalyst).count() == 1
        symbol = db.query(ScannerSymbol).filter_by(ticker="SINT").one()
        assert symbol.catalyst_type == "Regulatory filing"
        assert symbol.news_headline == "SEC 8-K: Current report"


def test_execution_api_keeps_prepare_approve_and_arm_as_separate_steps(client_and_session):
    client, testing_session = client_and_session
    with testing_session() as db:
        plan = TradePlan(
            plan_date=datetime.now(timezone.utc).date(),
            ticker="SINT",
            account_size=10_000,
            max_risk_per_trade_pct=0.5,
            entry_price=4.20,
            stop_price=4.00,
            target_price=4.60,
            risk_per_share=0.20,
            shares=250,
            max_loss=50,
            r_multiple=2,
            warnings=[],
        )
        db.add(plan)
        db.commit()
        db.refresh(plan)
        plan_id = plan.id

    defaults = client.get("/integrations/automation/settings")
    assert defaults.status_code == 200
    assert defaults.json()["enabled"] is False
    assert defaults.json()["kill_switch_engaged"] is True

    prepared = client.post(
        "/integrations/executions",
        json={"trade_plan_id": plan_id, "order_type": "limit", "time_in_force": "day"},
    )
    assert prepared.status_code == 201
    intent_id = prepared.json()["intent"]["id"]
    assert prepared.json()["intent"]["status"] == "pending_approval"
    assert isinstance(prepared.json()["intent"]["limit_price"], float)
    assert isinstance(prepared.json()["intent"]["stop_price"], float)

    approved = client.post(
        f"/integrations/executions/{intent_id}/approve",
        json={"acknowledge_warnings": True},
    )
    assert approved.status_code == 200
    assert approved.json()["intent"]["status"] == "approved"
    assert client.get("/integrations/executions").json()[0]["id"] == intent_id

    missing_phrase = client.post(
        "/integrations/automation/kill-switch",
        json={"engaged": False, "confirmation": ""},
    )
    assert missing_phrase.status_code == 422
    released = client.post(
        "/integrations/automation/kill-switch",
        json={"engaged": False, "confirmation": "ARM PAPER AUTOMATION"},
    )
    assert released.status_code == 200
    assert released.json()["kill_switch_engaged"] is False


def test_market_snapshot_decimal_values_have_a_numeric_json_contract(client_and_session):
    client, testing_session = client_and_session
    now = datetime.now(timezone.utc)
    with testing_session() as db:
        db.add(
            MarketDataSnapshot(
                ticker="SINT",
                provider="alpaca",
                source_feed="iex",
                price=Decimal("4.200001"),
                bid=Decimal("4.19"),
                ask=Decimal("4.21"),
                spread_pct=0.48,
                volume=12_345,
                vwap=Decimal("4.10"),
                previous_close=Decimal("3.90"),
                event_time=now,
                observed_at=now,
                delay_seconds=0,
                is_consolidated=False,
            )
        )
        db.commit()

    response = client.get("/integrations/market-data/snapshots")

    assert response.status_code == 200
    snapshot = response.json()[0]
    for field in ("price", "bid", "ask", "vwap", "previous_close"):
        assert isinstance(snapshot[field], float)


def test_paid_sip_sync_is_rejected_before_provider_access(client_and_session):
    client, _ = client_and_session
    client.app.dependency_overrides[get_settings] = lambda: _settings(
        alpaca_api_key_id="paper-key",
        alpaca_api_secret_key="paper-secret",
        alpaca_scanner_feed="sip",
    )

    response = client.post(
        "/integrations/market-data/sync",
        json={"symbols": ["SINT"], "feed": "sip"},
    )

    assert response.status_code == 403
    assert "not verified" in response.json()["detail"]


def test_automation_run_rejects_unsafe_broker_configuration(client_and_session):
    client, _ = client_and_session
    client.app.dependency_overrides[get_settings] = lambda: _settings(
        alpaca_trading_base_url="https://api.alpaca.markets",
        allow_live_trading=True,
    )

    response = client.post("/integrations/automation/run")

    assert response.status_code == 403
    assert "exact Alpaca paper endpoint" in response.json()["detail"]
