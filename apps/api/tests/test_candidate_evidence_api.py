"""HTTP coverage for immutable Candidate Evidence and freshness states."""

import asyncio
from datetime import timedelta
from typing import Iterator

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.scanner_sessions import router
from app.scanner_sessions import ScannerSessions, get_scanner_sessions
from app.scanner_sessions.domain import DiscoveryResult
from app.schemas.scanner_sessions import NormalizedDiscoveryHit
from test_scanner_sessions_api import (
    ControlledDiscovery,
    FIXED_START,
    _wait_for_terminal,
    scanner_database_url,
)


def _candidate_hit(**changes) -> NormalizedDiscoveryHit:
    payload = {
        "source": "alpaca_delayed_bars",
        "source_reference": "bar:SINT:2026-07-06T13:29:00Z",
        "observed_at": FIXED_START,
        "ticker": "SINT",
        "discovery_reason": "Market movement: +10.00%",
        "evidence_type": "market_movement",
        "evidence_value": 10.0,
        "provenance": {
            "data_tier": "delayed_consolidated",
            "feed": "sip",
            "expected_delay_seconds": 900,
            "provider_event_at": "2026-07-06T13:29:00Z",
        },
        "security_identifier_source": "evidence-test",
        "security_identifier": "security-sint",
        "issuer_name": "Evidence Research Corp",
        "exchange": "NASDAQ",
        "listing_status": "active",
        "instrument_type": "common_stock",
        "effective_from": "2020-01-01",
    }
    payload.update(changes)
    return NormalizedDiscoveryHit(**payload)


@pytest.fixture
def evidence_clock() -> list:
    return [FIXED_START]


@pytest.fixture
def evidence_client(
    scanner_database_url: str,
    evidence_clock: list,
) -> Iterator[TestClient]:
    engine = create_engine(scanner_database_url, pool_pre_ping=True)
    session_factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    discovery = ControlledDiscovery(
        result=DiscoveryResult(
            records_count=1,
            message="Delayed evidence test discovery completed.",
            details={
                "data_tier": "delayed_consolidated",
                "expected_delay_seconds": 900,
                "provider_event_at": "2026-07-06T13:29:00Z",
            },
            hits=(_candidate_hit(),),
        )
    )
    scanner_sessions = ScannerSessions(
        session_factory,
        discovery_factory=lambda started_at: discovery,
        clock=lambda: evidence_clock[0],
    )
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_scanner_sessions] = lambda: scanner_sessions
    with TestClient(app) as client:
        yield client
    asyncio.run(scanner_sessions.shutdown())
    engine.dispose()


def _start_completed_session(client: TestClient) -> dict:
    started = client.post("/scanner-sessions")
    assert started.status_code == 202
    return _wait_for_terminal(client, started.json()["id"])


def test_delayed_consolidated_discovery_is_recorded_as_fresh_candidate_evidence(
    evidence_client: TestClient,
):
    session = _start_completed_session(evidence_client)

    evidence = session["candidates"][0]["evidence"]

    assert len(evidence) == 1
    assert evidence[0] == {
        "id": evidence[0]["id"],
        "evidence_type": "market_movement",
        "value_state": "known",
        "normalized_value": 10.0,
        "source_reference": "bar:SINT:2026-07-06T13:29:00Z",
        "event_at": "2026-07-06T13:29:00Z",
        "observed_at": "2026-07-06T13:45:00Z",
        "data_tier": "delayed_consolidated",
        "expected_delay_seconds": 900,
        "recorded_freshness_policy_version": "candidate-evidence-v1",
        "recorded_freshness_result": "fresh",
        "recorded_freshness_reason": "within_policy_limits",
        "recorded_event_age_seconds": 960.0,
        "recorded_observation_age_seconds": 0.0,
        "recorded_freshness_evaluated_at": "2026-07-06T13:45:00Z",
        "current_freshness_result": "fresh",
        "current_freshness_reason": "within_policy_limits",
        "current_event_age_seconds": 960.0,
        "current_observation_age_seconds": 0.0,
        "current_freshness_evaluated_at": "2026-07-06T13:45:00Z",
        "supersedes_evidence_id": None,
        "supersession_type": None,
        "superseded_by_evidence_ids": [],
        "supports_current_positive": True,
    }


def test_fresh_evidence_stops_supporting_current_positives_as_time_passes(
    evidence_client: TestClient,
    evidence_clock: list,
):
    session = _start_completed_session(evidence_client)
    candidate = session["candidates"][0]
    initial = candidate["evidence"][0]
    assert initial["recorded_freshness_result"] == "fresh"
    assert initial["current_freshness_result"] == "fresh"
    assert initial["supports_current_positive"] is True

    evidence_clock[0] = FIXED_START + timedelta(minutes=16)
    reread = evidence_client.get(f"/scanner-sessions/{session['id']}")

    assert reread.status_code == 200
    current = reread.json()["candidates"][0]["evidence"][0]
    assert current["recorded_freshness_result"] == "fresh"
    assert current["current_freshness_result"] == "stale"
    assert current["current_freshness_reason"] == "provider_event_too_old"
    assert current["current_event_age_seconds"] == 1920.0
    assert current["supports_current_positive"] is False


def test_http_evidence_distinguishes_stale_unknown_verified_negative_and_history(
    evidence_client: TestClient,
):
    session = _start_completed_session(evidence_client)
    candidate = session["candidates"][0]
    candidate_url = f"/scanner-sessions/{session['id']}/candidates/{candidate['id']}/evidence"

    stale_response = evidence_client.post(
        candidate_url,
        json={
            "evidence_type": "market_price",
            "value_state": "known",
            "normalized_value": 1.25,
            "source_reference": "quote:sint:stale",
            "event_at": "2026-07-06T13:14:00Z",
            "observed_at": "2026-07-06T13:45:00Z",
            "data_tier": "delayed_consolidated",
            "expected_delay_seconds": 900,
        },
    )
    assert stale_response.status_code == 201
    stale = stale_response.json()
    assert stale["recorded_freshness_result"] == "stale"
    assert stale["current_freshness_result"] == "stale"
    assert stale["recorded_freshness_reason"] == "provider_event_too_old"
    assert stale["recorded_event_age_seconds"] == 1860.0
    assert stale["supports_current_positive"] is False

    causally_impossible = evidence_client.post(
        candidate_url,
        json={
            "evidence_type": "market_price",
            "value_state": "known",
            "normalized_value": 1.28,
            "source_reference": "quote:sint:causally-impossible",
            "event_at": "2026-07-06T13:44:00Z",
            "observed_at": "2026-07-06T13:43:00Z",
            "data_tier": "delayed_consolidated",
            "expected_delay_seconds": 900,
        },
    )
    assert causally_impossible.status_code == 201
    causal = causally_impossible.json()
    assert causal["recorded_freshness_result"] == "unknown"
    assert causal["current_freshness_result"] == "unknown"
    assert causal["recorded_freshness_reason"] == "event_after_observation"
    assert causal["supports_current_positive"] is False

    mismatched_correction = evidence_client.post(
        candidate_url,
        json={
            "evidence_type": "above_vwap",
            "value_state": "verified_negative",
            "normalized_value": False,
            "source_reference": "quote:sint:mismatched-correction",
            "event_at": "2026-07-06T13:44:00Z",
            "observed_at": "2026-07-06T13:45:00Z",
            "data_tier": "delayed_consolidated",
            "expected_delay_seconds": 900,
            "supersedes_evidence_id": stale["id"],
            "supersession_type": "correction",
        },
    )
    assert mismatched_correction.status_code == 422
    assert "same evidence type" in mismatched_correction.json()["detail"]

    unknown_response = evidence_client.post(
        candidate_url,
        json={
            "evidence_type": "market_price",
            "value_state": "unknown",
            "source_reference": "quote:sint:missing",
            "event_at": "2026-07-06T13:44:00Z",
            "observed_at": "2026-07-06T13:45:00Z",
            "data_tier": "delayed_consolidated",
            "expected_delay_seconds": 900,
        },
    )
    assert unknown_response.status_code == 201
    unknown = unknown_response.json()
    assert unknown["value_state"] == "unknown"
    assert unknown["normalized_value"] is None
    assert unknown["recorded_freshness_result"] == "fresh"
    assert unknown["current_freshness_result"] == "fresh"
    assert unknown["supports_current_positive"] is False

    negative_response = evidence_client.post(
        candidate_url,
        json={
            "evidence_type": "above_vwap",
            "value_state": "verified_negative",
            "normalized_value": False,
            "source_reference": "quote:sint:below-vwap",
            "event_at": "2026-07-06T13:44:00Z",
            "observed_at": "2026-07-06T13:45:00Z",
            "data_tier": "delayed_consolidated",
            "expected_delay_seconds": 900,
        },
    )
    assert negative_response.status_code == 201
    negative = negative_response.json()
    assert negative["value_state"] == "verified_negative"
    assert negative["normalized_value"] is False
    assert negative["recorded_freshness_result"] == "fresh"
    assert negative["current_freshness_result"] == "fresh"
    assert negative["supports_current_positive"] is False

    correction_response = evidence_client.post(
        candidate_url,
        json={
            "evidence_type": "market_price",
            "value_state": "known",
            "normalized_value": 1.30,
            "source_reference": "quote:sint:corrected",
            "event_at": "2026-07-06T13:44:30Z",
            "observed_at": "2026-07-06T13:45:00Z",
            "data_tier": "delayed_consolidated",
            "expected_delay_seconds": 900,
            "supersedes_evidence_id": stale["id"],
            "supersession_type": "correction",
        },
    )
    assert correction_response.status_code == 201
    correction = correction_response.json()
    assert correction["supersedes_evidence_id"] == stale["id"]
    assert correction["supersession_type"] == "correction"

    new_observation_response = evidence_client.post(
        candidate_url,
        json={
            "evidence_type": "market_price",
            "value_state": "known",
            "normalized_value": 1.35,
            "source_reference": "quote:sint:new-observation",
            "event_at": "2026-07-06T13:45:00Z",
            "observed_at": "2026-07-06T13:45:00Z",
            "data_tier": "delayed_consolidated",
            "expected_delay_seconds": 900,
            "supersedes_evidence_id": correction["id"],
            "supersession_type": "new_observation",
        },
    )
    assert new_observation_response.status_code == 201
    new_observation = new_observation_response.json()
    assert new_observation["supersession_type"] == "new_observation"

    out_of_order_event = evidence_client.post(
        candidate_url,
        json={
            "evidence_type": "market_price",
            "value_state": "known",
            "normalized_value": 1.36,
            "source_reference": "quote:sint:older-event",
            "event_at": "2026-07-06T13:44:30Z",
            "observed_at": "2026-07-06T13:45:00Z",
            "data_tier": "delayed_consolidated",
            "expected_delay_seconds": 900,
            "supersedes_evidence_id": new_observation["id"],
            "supersession_type": "new_observation",
        },
    )
    assert out_of_order_event.status_code == 422
    assert "event time" in out_of_order_event.json()["detail"]

    out_of_order_observation = evidence_client.post(
        candidate_url,
        json={
            "evidence_type": "market_price",
            "value_state": "known",
            "normalized_value": 1.37,
            "source_reference": "quote:sint:older-observation",
            "event_at": "2026-07-06T13:45:00Z",
            "observed_at": "2026-07-06T13:44:30Z",
            "data_tier": "delayed_consolidated",
            "expected_delay_seconds": 900,
            "supersedes_evidence_id": new_observation["id"],
            "supersession_type": "new_observation",
        },
    )
    assert out_of_order_observation.status_code == 422
    assert "observation time" in out_of_order_observation.json()["detail"]

    reread = evidence_client.get(f"/scanner-sessions/{session['id']}").json()
    by_id = {item["id"]: item for item in reread["candidates"][0]["evidence"]}
    assert by_id[stale["id"]]["normalized_value"] == 1.25
    assert by_id[stale["id"]]["superseded_by_evidence_ids"] == [correction["id"]]
    assert by_id[correction["id"]]["normalized_value"] == 1.30
    assert by_id[correction["id"]]["superseded_by_evidence_ids"] == [new_observation["id"]]
    assert by_id[correction["id"]]["supports_current_positive"] is False
    assert by_id[new_observation["id"]]["normalized_value"] == 1.35


def test_unknown_evidence_cannot_be_encoded_as_a_false_value(evidence_client: TestClient):
    session = _start_completed_session(evidence_client)
    candidate = session["candidates"][0]

    response = evidence_client.post(
        f"/scanner-sessions/{session['id']}/candidates/{candidate['id']}/evidence",
        json={
            "evidence_type": "above_vwap",
            "value_state": "unknown",
            "normalized_value": False,
            "source_reference": "quote:sint:invalid-unknown",
            "data_tier": "delayed_consolidated",
        },
    )

    assert response.status_code == 422
