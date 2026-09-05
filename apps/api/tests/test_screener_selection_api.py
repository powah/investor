"""HTTP behavior with real orchestration/database and controlled neutral sources."""
from datetime import datetime, timezone
from threading import Event

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.scanner_sessions as production
from app.api.scanner_sessions import router
from app.core.config import Settings
from app.models.integrations import ProviderCapabilityCheck
from app.services.capabilities import capability_configuration_fingerprint
from app.scanner_sessions import ScannerSessions, get_scanner_sessions
from app.scanner_sessions.domain import DiscoveryResult, DiscoveryUnavailable
from app.scanner_sessions.selection import CapabilityAwareDiscovery, RecordedCapability
from app.schemas.scanner_sessions import NormalizedDiscoveryHit
from test_scanner_sessions_api import (
    scanner_database_url, ControlledDiscovery, FIXED_START, _supplementary_input, _wait_for_terminal,
)


def source(name, event="2026-07-06T13:44:00+00:00", *, failure=None, release=None):
    tier = "delayed_consolidated" if name == "bars" else "screener_consolidated"
    metadata = {"provider_event_at": event, "data_tier": tier, "feed": "sip",
                "expected_delay_seconds": 900 if name == "bars" else None, "request_id": name}
    adapter = ControlledDiscovery(
        result=DiscoveryResult(records_count=1, message=name, details=metadata, hits=(
            NormalizedDiscoveryHit(**_supplementary_input(
                source=name, discovery_reason=f"Discovered by {name}", provenance=metadata,
            )),
        )), failure=failure, release=release,
    )
    adapter.source = name
    return adapter


@pytest.fixture
def run_selection(scanner_database_url):
    engine = create_engine(scanner_database_url)
    sessions = sessionmaker(bind=engine)
    clients = []
    def run(*, statuses=("available", "available"), instant=FIXED_START, movers=None, actives=None, bars=None):
        adapters = {"screener:movers": movers or source("movers"), "screener:most_actives": actives or source("actives")}
        fallback = bars or source("bars")
        capabilities = {
            name: RecordedCapability(status, index + 1, instant.isoformat(), f"probe-{index}")
            for index, (name, status) in enumerate(zip(adapters, statuses)) if status is not None
        }
        scanner = ScannerSessions(sessions, clock=lambda: instant, discovery_factory=lambda started_at:
            CapabilityAwareDiscovery(started_at=started_at, capabilities=capabilities, screeners=adapters, fallback=fallback))
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_scanner_sessions] = lambda: scanner
        client = TestClient(app)
        client.__enter__()
        clients.append(client)
        started = client.post("/scanner-sessions").json()
        return client, started, list(adapters.values()), fallback
    yield run
    for client in clients:
        client.__exit__(None, None, None)
    engine.dispose()


def test_accessible_screeners_deduplicate_security_without_losing_source_reasons(run_selection):
    client, started, adapters, bars = run_selection()
    result = _wait_for_terminal(client, started["id"])
    assert result["status"] == "completed"
    assert bars.calls == 0
    assert [adapter.calls for adapter in adapters] == [1, 1]
    assert len(result["candidates"]) == 1
    assert result["candidates"][0]["discovery_sources"] == ["movers", "actives"]
    assert result["candidates"][0]["discovery_reasons"] == ["Discovered by movers", "Discovered by actives"]
    assert len(result["candidates"][0]["discovery_hit_ids"]) == 2
    assert [hit["provenance"]["request_id"] for hit in result["discovery_hits"]] == ["movers", "actives"]
    assert result["diagnostics"][0]["details"]["fallback_used"] is False
    assert client.get(f"/scanner-sessions/{started['id']}").json() == result


@pytest.mark.parametrize("statuses", [(None, None), ("unavailable", "failed"), ("available", "unavailable")])
def test_capability_selection_and_mixed_source_fallback(run_selection, statuses):
    client, started, adapters, bars = run_selection(statuses=statuses)
    result = _wait_for_terminal(client, started["id"])
    assert result["status"] == "completed"
    assert bars.calls == 1
    assert [adapter.calls for adapter in adapters] == [int(status == "available") for status in statuses]
    details = result["diagnostics"][0]["details"]
    assert details["fallback_used"] is True
    assert details["sources"]["bars"]["data_tier"] == "delayed_consolidated"
    assert result["discovery_hits"][-1]["provenance"]["expected_delay_seconds"] == 900
    assert len(result["candidates"]) == 1
    if "available" in statuses:
        assert "data_tier" not in details  # no single misleading tier for mixed sources
        assert len(result["candidates"][0]["discovery_hit_ids"]) == 2
    else:
        assert details["data_tier"] == "delayed_consolidated"


@pytest.mark.parametrize("instant", [
    datetime(2026, 7, 6, 12, tzinfo=timezone.utc),  # premarket
    FIXED_START,  # providers can also be stale after the open
])
def test_prior_day_screeners_are_retained_but_require_current_fallback(run_selection, instant):
    client, started, _, bars = run_selection(
        instant=instant, movers=source("movers", "2026-07-02T20:00:00Z"),
        actives=source("actives", "2026-07-02T20:00:00Z"),
    )
    result = _wait_for_terminal(client, started["id"])
    assert result["status"] == "completed"
    assert bars.calls == 1
    assert len(result["candidates"][0]["discovery_hit_ids"]) == 3
    details = result["diagnostics"][0]["details"]
    assert details["selected_sources"] == ["bars"]
    assert details["sources"]["screener:movers"]["status"] == "inapplicable"


def test_same_day_premarket_update_is_not_proof_of_current_daily_rankings(run_selection):
    client, started, _, bars = run_selection(
        instant=datetime(2026, 7, 6, 12, tzinfo=timezone.utc),
        movers=source("movers", "2026-07-06T11:59:00Z"),
        actives=source("actives", "2026-07-06T11:59:00Z"),
    )
    result = _wait_for_terminal(client, started["id"])
    assert bars.calls == 1
    details = result["diagnostics"][0]["details"]
    assert details["selected_sources"] == ["bars"]
    assert details["sources"]["screener:movers"]["reason"] == "premarket_daily_rankings"
    assert result["discovery_hits"][0]["provenance"]["applicable_to_session"] is False


def test_closed_phase_does_not_request_screeners(run_selection):
    client, started, adapters, bars = run_selection(instant=datetime(2026, 7, 5, 14, tzinfo=timezone.utc))
    result = _wait_for_terminal(client, started["id"])
    assert result["market_phase"] == "closed"
    assert [adapter.calls for adapter in adapters] == [0, 0]
    assert bars.calls == 1
    assert result["diagnostics"][0]["details"]["sources"]["screener:movers"]["reason"] == "market_phase_closed"


@pytest.mark.parametrize("failure", [
    DiscoveryUnavailable(code="screener_unavailable", message="HTTP 403", details={"http_status": 403}),
    ValueError("Malformed screener"),
    TimeoutError("Request timed out"),
])
def test_runtime_errors_fall_back_even_after_available_probe(run_selection, failure):
    client, started, _, bars = run_selection(movers=source("movers", failure=failure))
    result = _wait_for_terminal(client, started["id"])
    assert result["status"] == "completed"
    assert bars.calls == 1
    assert "movers" not in result["candidates"][0]["discovery_sources"]
    assert result["diagnostics"][0]["details"]["sources"]["screener:movers"]["message"] == str(failure)


@pytest.mark.parametrize("available", [False, True])
def test_failed_fallback_requires_at_least_one_applicable_success(run_selection, available):
    client, started, _, _ = run_selection(
        statuses=("available" if available else None, None),
        bars=source("bars", failure=TimeoutError("Bars timed out")),
    )
    result = _wait_for_terminal(client, started["id"])
    assert result["status"] == ("completed" if available else "failed")
    assert result["diagnostics"][0]["details"]["sources"]["bars"]["status"] == "failed"


def test_failed_fallback_cannot_turn_prior_day_hits_into_completed_discovery(run_selection):
    client, started, _, _ = run_selection(
        movers=source("movers", "2026-07-02T20:00:00Z"), statuses=("available", None),
        bars=source("bars", failure=TimeoutError("Bars timed out")),
    )
    result = _wait_for_terminal(client, started["id"])
    assert result["status"] == "partial"
    assert len(result["discovery_hits"]) == len(result["candidates"]) == 1
    assert result["diagnostics"][0]["code"] == "required_discovery_unavailable"


@pytest.mark.parametrize("recorded", ["available", "unavailable", "missing", "other_account", "legacy", "newer_denial"])
def test_production_selection_uses_latest_recorded_access_for_configured_account(scanner_database_url, monkeypatch, recorded):
    engine = create_engine(scanner_database_url)
    sessions = sessionmaker(bind=engine)
    settings = Settings(_env_file=None, alpaca_api_key_id="selection-key", alpaca_api_secret_key="selection-secret")
    adapters = {"movers": source("movers"), "most_actives": source("actives")}
    bars = source("bars")
    monkeypatch.setattr(production, "AlpacaScreenerDiscovery", lambda settings, kind, universe: adapters[kind])
    monkeypatch.setattr(production, "AlpacaDelayedBarDiscovery", lambda *args, **kwargs: bars)
    with sessions() as db:
        db.query(ProviderCapabilityCheck).delete()
        if recorded != "missing":
            for kind in adapters:
                fingerprint = capability_configuration_fingerprint(settings) if recorded != "other_account" else "other"
                db.add(ProviderCapabilityCheck(
                    provider="alpaca", capability=f"screener:{kind}", endpoint="/screener",
                    status="unavailable" if recorded == "unavailable" else "available", message="Probe result",
                    tested_at=FIXED_START, details={} if recorded == "legacy" else {"configuration_fingerprint": fingerprint},
                ))
                if recorded == "newer_denial":
                    db.flush()
                    db.add(ProviderCapabilityCheck(
                        provider="alpaca", capability=f"screener:{kind}", endpoint="/screener",
                        status="unavailable", message="New denial", tested_at=FIXED_START,
                        details={"configuration_fingerprint": fingerprint},
                    ))
        db.commit()
    def factory(started_at):
        with sessions() as db:
            return production.build_discovery(db, settings, started_at)
    scanner = ScannerSessions(sessions, clock=lambda: FIXED_START, discovery_factory=factory)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_scanner_sessions] = lambda: scanner
    with TestClient(app) as client:
        started = client.post("/scanner-sessions").json()
        result = _wait_for_terminal(client, started["id"])
    assert result["status"] == "completed"
    assert bars.calls == int(recorded != "available")
    assert [adapter.calls for adapter in adapters.values()] == [int(recorded == "available")] * 2
    if recorded == "available":
        assert result["diagnostics"][0]["details"]["sources"]["screener:movers"]["capability"]["check_id"] > 0
    engine.dispose()


def test_selection_and_fallback_progress_are_visible_before_completion(run_selection):
    release = Event()
    bars = source("bars", release=release)
    client, started, _, _ = run_selection(statuses=(None, None), bars=bars)
    try:
        assert bars.started.wait(2)
        progress = client.get(f"/scanner-sessions/{started['id']}").json()
        assert progress["status"] == "running"
        assert progress["diagnostics"][0]["details"]["sources"]["bars"]["status"] == "running"
        assert "Using delayed consolidated bars" in progress["diagnostics"][0]["message"]
        assert client.post("/scanner-sessions").json()["id"] == started["id"]
        assert bars.calls == 1
    finally:
        release.set()
    assert _wait_for_terminal(client, started["id"])["status"] == "completed"
