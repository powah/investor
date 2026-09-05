from __future__ import annotations

import asyncio
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
from threading import Barrier, Event, Lock
from time import monotonic, sleep
from uuid import uuid4

from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.api.scanner_sessions import router
from app.scanner_sessions.supplementary_csv import (
    MAX_SUPPLEMENTARY_CSV_BYTES,
    MAX_SUPPLEMENTARY_INPUTS,
)
from app.scanner_sessions import (
    DiscoveryResult,
    DiscoveryUnavailable,
    ScannerSessions,
    get_scanner_sessions,
    resolve_exchange_session_identity,
)


API_ROOT = Path(__file__).resolve().parents[1]
FIXED_START = datetime(2026, 7, 6, 13, 45, tzinfo=timezone.utc)


class ControlledDiscovery:
    source = "controlled_market_movement"

    def __init__(self, *, release: Event | None = None, failure: Exception | None = None):
        self.release = release
        self.failure = failure
        self.calls = 0
        self.started = Event()
        self._lock = Lock()

    async def discover(self) -> DiscoveryResult:
        with self._lock:
            self.calls += 1
        self.started.set()
        if self.release is not None:
            while not self.release.is_set():
                await asyncio.sleep(0.01)
        if self.failure is not None:
            raise self.failure
        return DiscoveryResult(
            records_count=2,
            message="Controlled Market-Movement Discovery completed.",
            details={"symbols": ["SINT", "ABVC"]},
        )


def _alembic_config(database_url: str) -> Config:
    config = Config(str(API_ROOT / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", database_url)
    return config


@pytest.fixture(scope="module")
def scanner_database_url() -> Iterator[str]:
    admin_url = make_url(
        os.getenv(
            "SCANNER_TEST_DATABASE_URL",
            "postgresql+psycopg://trading:trading@127.0.0.1:5432/postgres",
        )
    )
    database_name = f"investor_scanner_sessions_test_{uuid4().hex}"
    database_url = admin_url.set(database=database_name)
    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{database_name}"'))
    except Exception as exc:
        pytest.fail(
            "Scanner Sessions HTTP tests require the isolated local PostgreSQL test target "
            f"from SCANNER_TEST_DATABASE_URL: {exc}"
        )

    try:
        command.upgrade(_alembic_config(database_url.render_as_string(hide_password=False)), "head")
        yield database_url.render_as_string(hide_password=False)
    finally:
        with admin_engine.connect() as connection:
            connection.execute(
                text(
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    "WHERE datname = :database_name AND pid <> pg_backend_pid()"
                ),
                {"database_name": database_name},
            )
            connection.execute(text(f'DROP DATABASE IF EXISTS "{database_name}"'))
        admin_engine.dispose()


@pytest.fixture
def scanner_client(scanner_database_url: str, request: pytest.FixtureRequest):
    engine = create_engine(scanner_database_url, pool_pre_ping=True)
    testing_session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    discovery = getattr(request, "param", ControlledDiscovery())
    scanner_sessions = ScannerSessions(
        testing_session,
        discovery_factory=lambda: discovery,
        clock=lambda: FIXED_START,
    )
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_scanner_sessions] = lambda: scanner_sessions
    with TestClient(app) as client:
        yield client, discovery
    engine.dispose()


def _supplementary_input(**overrides) -> dict:
    payload = {
        "source": "manual",
        "source_reference": "operator:research-desk",
        "ticker": "SINT",
        "discovery_reason": "Manual catalyst follow-up",
        "security_identifier_source": "test_registry",
        "security_identifier": "security-sint",
        "issuer_name": "SINT Research Corp",
        "exchange": "NASDAQ",
        "listing_status": "active",
        "instrument_type": "common_stock",
        "effective_from": "2020-01-01",
        "effective_to": None,
        "foreign_issuer": False,
        "depositary_to_underlying_ratio": None,
    }
    payload.update(overrides)
    return payload


def _wait_for_terminal(client: TestClient, session_id: int) -> dict:
    deadline = monotonic() + 5
    while monotonic() < deadline:
        payload = client.get(f"/scanner-sessions/{session_id}").json()
        if payload["status"] != "running":
            return payload
        sleep(0.02)
    pytest.fail(f"Scanner Session {session_id} did not reach a terminal state.")


def test_start_records_fixed_identity_versions_progress_and_completed_diagnostic(scanner_client):
    client, discovery = scanner_client

    response = client.post("/scanner-sessions")

    assert response.status_code == 202
    started = response.json()
    assert started["status"] == "running"
    assert started["started_at"] == "2026-07-06T13:45:00Z"
    assert started["trading_date"] == "2026-07-06"
    assert started["market_phase"] == "regular"
    assert started["scanner_policy_version"] == "scanner-policy-v1"
    assert started["scanner_policy_settings"] == {
        "market_cap_ceiling_usd": 2_000_000_000,
        "minimum_price_usd": 1,
        "required_sources": ["market_movement"],
    }
    assert started["scoring_model_version"] == "scoring-model-v1"
    assert started["progress"] == {"completed": 0, "total": 1, "percent": 0}

    completed = _wait_for_terminal(client, started["id"])

    assert completed["status"] == "completed"
    assert completed["stage"] == "completed"
    assert completed["progress"] == {"completed": 1, "total": 1, "percent": 100}
    assert completed["diagnostics"] == [
        {
            "source": "controlled_market_movement",
            "capability": "market_movement",
            "required": True,
            "status": "completed",
            "records_count": 2,
            "code": None,
            "message": "Controlled Market-Movement Discovery completed.",
            "details": {"symbols": ["SINT", "ABVC"]},
            "started_at": "2026-07-06T13:45:00Z",
            "completed_at": "2026-07-06T13:45:00Z",
        }
    ]
    assert discovery.calls == 1

    history = client.get("/scanner-sessions?limit=1").json()
    assert history == [
        {
            "id": completed["id"],
            "status": "completed",
            "stage": "completed",
            "started_at": "2026-07-06T13:45:00Z",
            "completed_at": "2026-07-06T13:45:00Z",
            "trading_date": "2026-07-06",
            "market_phase": "regular",
            "scanner_policy_version": "scanner-policy-v1",
            "scoring_model_version": "scoring-model-v1",
            "progress": {"completed": 1, "total": 1, "percent": 100},
            "diagnostics_count": 1,
            "discovery_hits_count": 0,
            "candidates_count": 0,
        }
    ]


@pytest.mark.parametrize(
    "scanner_client",
    [ControlledDiscovery(release=Event())],
    indirect=True,
)
def test_repeated_and_concurrent_starts_return_one_active_session(scanner_client):
    client, discovery = scanner_client
    barrier = Barrier(3)

    def start_scanner() -> dict:
        barrier.wait()
        response = client.post("/scanner-sessions")
        assert response.status_code == 202
        return response.json()

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(start_scanner) for _ in range(2)]
        barrier.wait()
        sessions = [future.result(timeout=5) for future in futures]

    assert sessions[0]["id"] == sessions[1]["id"]
    assert discovery.started.wait(2)
    repeated = client.post(
        "/scanner-sessions",
        json={"supplementary_inputs": [_supplementary_input()]},
    )
    assert repeated.status_code == 409
    assert repeated.json()["detail"] == (
        f"Scanner Session {sessions[0]['id']} is already running; supplementary inputs "
        "were not accepted."
    )
    assert discovery.calls == 1

    discovery.release.set()
    completed = _wait_for_terminal(client, sessions[0]["id"])
    assert completed["status"] == "completed"


@pytest.mark.parametrize(
    "scanner_client",
    [
        ControlledDiscovery(
            failure=DiscoveryUnavailable(
                code="required_discovery_unavailable",
                message="Alpaca mover and most-active screeners are unavailable for this account.",
                details={"capabilities": ["movers", "most_actives"]},
            )
        )
    ],
    indirect=True,
)
def test_required_discovery_failure_is_persisted_and_terminal(scanner_client):
    client, _ = scanner_client

    started = client.post("/scanner-sessions").json()
    failed = _wait_for_terminal(client, started["id"])

    assert failed["status"] == "failed"
    assert failed["stage"] == "failed"
    assert failed["completed_at"] == "2026-07-06T13:45:00Z"
    assert failed["diagnostics"][0]["status"] == "unavailable"
    assert failed["diagnostics"][0]["code"] == "required_discovery_unavailable"
    assert failed["diagnostics"][0]["message"] == (
        "Alpaca mover and most-active screeners are unavailable for this account."
    )
    assert failed["diagnostics"][0]["details"] == {
        "capabilities": ["movers", "most_actives"]
    }


def test_manual_and_csv_hits_are_retained_admitted_and_deduplicated_by_security(scanner_client):
    client, _ = scanner_client
    inputs = [
        _supplementary_input(),
        _supplementary_input(
            source="csv",
            source_reference="supplementary.csv:2",
            ticker="SNTX",
            exchange="NYSE",
            effective_from="2021-01-01",
            discovery_reason="CSV high-volume screen",
        ),
        _supplementary_input(
            ticker="ABVC",
            security_identifier="security-abvc",
            issuer_name="Foreign Biotech Ltd",
            exchange="NYSE American",
            instrument_type="american_depositary_share",
            foreign_issuer=True,
            depositary_to_underlying_ratio=2.5,
        ),
        _supplementary_input(
            ticker="FUND",
            security_identifier="security-fund",
            instrument_type="fund",
        ),
        _supplementary_input(
            ticker="PINK",
            security_identifier="security-pink",
            exchange="OTC",
        ),
        _supplementary_input(
            ticker="MYST",
            security_identifier_source=None,
            security_identifier=None,
            instrument_type=None,
        ),
    ]

    response = client.post("/scanner-sessions", json={"supplementary_inputs": inputs})

    assert response.status_code == 202
    session = response.json()
    assert [hit["admission_outcome"] for hit in session["discovery_hits"]] == [
        "admitted",
        "admitted",
        "admitted",
        "rejected",
        "rejected",
        "unresolved",
    ]
    assert session["discovery_hits"][3]["admission_reasons"] == ["unsupported_instrument_type"]
    assert session["discovery_hits"][4]["admission_reasons"] == ["unsupported_exchange"]
    assert session["discovery_hits"][5]["admission_reasons"] == [
        "security_identity_unresolved",
        "instrument_classification_unresolved",
    ]
    assert session["discovery_hits"][5]["listing"] is None
    assert session["discovery_hits"][5]["observed_listing"] == {
        "ticker": "MYST",
        "exchange": "nasdaq",
        "status": "active",
        "instrument_type": None,
        "effective_from": "2020-01-01",
        "effective_to": None,
        "foreign_issuer": False,
        "depositary_to_underlying_ratio": None,
    }

    candidates = session["candidates"]
    assert len(candidates) == 2
    sint = next(candidate for candidate in candidates if candidate["security"]["identifier"] == "security-sint")
    assert sint["discovery_sources"] == ["manual", "csv"]
    assert sint["discovery_reasons"] == ["Manual catalyst follow-up", "CSV high-volume screen"]
    assert len(sint["discovery_hit_ids"]) == 2
    assert {listing["ticker"] for listing in sint["observed_listings"]} == {"SINT", "SNTX"}
    ads = next(candidate for candidate in candidates if candidate["security"]["identifier"] == "security-abvc")
    assert ads["observed_listings"][0]["instrument_type"] == "american_depositary_share"
    assert ads["observed_listings"][0]["foreign_issuer"] is True
    assert ads["observed_listings"][0]["depositary_to_underlying_ratio"] == 2.5

    completed = _wait_for_terminal(client, session["id"])
    assert completed["status"] == "completed"
    assert completed["candidates"] == candidates


@pytest.mark.parametrize(
    "instrument_type",
    ["fund", "preferred_share", "unit", "warrant", "right"],
)
def test_candidate_admission_rejects_each_unsupported_instrument_type(
    scanner_client,
    instrument_type: str,
):
    client, _ = scanner_client

    started = client.post(
        "/scanner-sessions",
        json={
            "supplementary_inputs": [
                _supplementary_input(
                    ticker="NOPE",
                    security_identifier=f"unsupported-{instrument_type}",
                    instrument_type=instrument_type,
                )
            ]
        },
    ).json()

    assert started["candidates"] == []
    assert started["discovery_hits"][0]["admission_outcome"] == "rejected"
    assert started["discovery_hits"][0]["admission_reasons"] == [
        "unsupported_instrument_type"
    ]


def test_ticker_changes_reuse_security_while_ticker_reuse_does_not_merge_history(scanner_client):
    client, _ = scanner_client
    first = client.post(
        "/scanner-sessions",
        json={
            "supplementary_inputs": [
                _supplementary_input(ticker="OLD", security_identifier="issuer-a")
            ]
        },
    ).json()
    first = _wait_for_terminal(client, first["id"])
    original_security_id = first["candidates"][0]["security"]["id"]

    second = client.post(
        "/scanner-sessions",
        json={
            "supplementary_inputs": [
                _supplementary_input(
                    ticker="NEW",
                    security_identifier="issuer-a",
                    effective_from="2026-01-01",
                ),
                _supplementary_input(
                    ticker="OLD",
                    security_identifier="issuer-b",
                    effective_from="2026-02-01",
                ),
            ]
        },
    ).json()

    by_identifier = {
        candidate["security"]["identifier"]: candidate for candidate in second["candidates"]
    }
    assert by_identifier["issuer-a"]["security"]["id"] == original_security_id
    assert by_identifier["issuer-a"]["observed_listings"][0]["ticker"] == "NEW"
    assert by_identifier["issuer-b"]["security"]["id"] != original_security_id
    assert by_identifier["issuer-b"]["observed_listings"][0]["ticker"] == "OLD"
    assert first["candidates"][0]["observed_listings"][0]["ticker"] == "OLD"


def test_session_history_is_paginated_and_returns_summaries(scanner_client):
    client, _ = scanner_client
    first = client.post("/scanner-sessions").json()
    _wait_for_terminal(client, first["id"])
    second = client.post("/scanner-sessions").json()
    _wait_for_terminal(client, second["id"])

    first_page = client.get("/scanner-sessions?limit=1").json()
    second_page = client.get("/scanner-sessions?limit=1&offset=1").json()

    assert [item["id"] for item in first_page] == [second["id"]]
    assert [item["id"] for item in second_page] == [first["id"]]
    assert "diagnostics" not in first_page[0]
    assert "discovery_hits" not in first_page[0]
    assert "candidates" not in first_page[0]


@pytest.mark.parametrize("field", ["security_identifier_source", "security_identifier"])
@pytest.mark.parametrize("sentinel", ["unknown", " Unresolved ", "UNKNOWN"])
def test_sentinel_security_identity_remains_unresolved(scanner_client, field, sentinel):
    client, _ = scanner_client
    response = client.post(
        "/scanner-sessions",
        json={"supplementary_inputs": [_supplementary_input(**{field: sentinel})]},
    )
    assert response.status_code == 202
    session = _wait_for_terminal(client, response.json()["id"])
    hit = session["discovery_hits"][0]
    assert hit["admission_outcome"] == "unresolved"
    assert "security_identity_unresolved" in hit["admission_reasons"]
    assert hit["security"] is None
    assert session["candidates"] == []


@pytest.mark.parametrize("known_foreign_issuer", [True, False, None])
def test_ads_reuses_known_foreign_issuer_when_observation_is_omitted(
    scanner_client, known_foreign_issuer
):
    client, _ = scanner_client
    known = _supplementary_input(
        security_identifier=f"ads-foreign-issuer-{known_foreign_issuer}",
        instrument_type="american_depositary_share",
        foreign_issuer=known_foreign_issuer,
    )
    first = client.post("/scanner-sessions", json={"supplementary_inputs": [known]})
    assert first.status_code == 202
    original = _wait_for_terminal(client, first.json()["id"])
    omitted = {key: value for key, value in known.items() if key != "foreign_issuer"}
    second = client.post("/scanner-sessions", json={"supplementary_inputs": [omitted]})
    assert second.status_code == 202
    session = _wait_for_terminal(client, second.json()["id"])
    hit = session["discovery_hits"][0]
    expected = "unresolved" if known_foreign_issuer is None else (
        "admitted" if known_foreign_issuer else "rejected"
    )
    assert hit["admission_outcome"] == expected
    assert hit["observed_listing"]["foreign_issuer"] is None
    if known_foreign_issuer is not None:
        assert hit["listing"]["id"] == original["discovery_hits"][0]["listing"]["id"]
        assert hit["listing"]["foreign_issuer"] is known_foreign_issuer
    else:
        assert "foreign_issuer_status_unresolved" in hit["admission_reasons"]
    assert len(session["candidates"]) == (1 if known_foreign_issuer is True else 0)


def test_candidate_listing_snapshots_survive_later_enrichment(scanner_client):
    client, _ = scanner_client
    original_input = _supplementary_input(
        security_identifier="immutable-ads-listing",
        instrument_type="american_depositary_share",
        foreign_issuer=True,
    )
    first = client.post(
        "/scanner-sessions", json={"supplementary_inputs": [original_input]}
    )
    assert first.status_code == 202
    original = _wait_for_terminal(client, first.json()["id"])
    enriched_input = {
        **original_input,
        "effective_to": "2026-07-07",
        "depositary_to_underlying_ratio": 2.5,
    }
    second = client.post(
        "/scanner-sessions",
        json={"supplementary_inputs": [original_input, enriched_input, enriched_input]},
    )
    assert second.status_code == 202
    enriched = _wait_for_terminal(client, second.json()["id"])

    reread = client.get(f"/scanner-sessions/{original['id']}").json()
    assert reread["candidates"] == original["candidates"]
    listings = enriched["candidates"][0]["observed_listings"]
    assert len(listings) == 2
    assert listings[0]["id"] == listings[1]["id"]
    assert listings[0]["security_id"] == listings[1]["security_id"]
    for listing, hit in zip(listings, enriched["discovery_hits"]):
        observation = {
            key: value for key, value in listing.items()
            if key not in {"id", "security_id"}
        }
        assert observation == hit["observed_listing"]
    assert listings[0]["effective_to"] is None
    assert listings[0]["depositary_to_underlying_ratio"] is None
    assert listings[1]["effective_to"] == "2026-07-07"
    assert listings[1]["depositary_to_underlying_ratio"] == 2.5


def test_optional_listing_metadata_can_be_omitted_or_enriched_without_a_conflict(scanner_client):
    client, _ = scanner_client
    known_ratio = _supplementary_input(
        ticker="ABVC",
        security_identifier="optional-known-first",
        exchange="NYSE American",
        instrument_type="american_depositary_share",
        foreign_issuer=True,
        depositary_to_underlying_ratio=2.5,
    )
    first = client.post(
        "/scanner-sessions", json={"supplementary_inputs": [known_ratio]}
    ).json()
    _wait_for_terminal(client, first["id"])

    omitted_ratio = {**known_ratio, "depositary_to_underlying_ratio": None}
    second = client.post(
        "/scanner-sessions", json={"supplementary_inputs": [omitted_ratio]}
    ).json()
    assert second["discovery_hits"][0]["admission_outcome"] == "admitted"
    assert second["discovery_hits"][0]["listing"]["depositary_to_underlying_ratio"] == 2.5
    _wait_for_terminal(client, second["id"])

    unknown_first = {
        **known_ratio,
        "security_identifier": "optional-enriched-later",
        "depositary_to_underlying_ratio": None,
    }
    third = client.post(
        "/scanner-sessions", json={"supplementary_inputs": [unknown_first]}
    ).json()
    assert third["discovery_hits"][0]["admission_outcome"] == "admitted"
    _wait_for_terminal(client, third["id"])

    learned_later = {**unknown_first, "depositary_to_underlying_ratio": 3.0}
    fourth = client.post(
        "/scanner-sessions", json={"supplementary_inputs": [learned_later]}
    ).json()
    assert fourth["discovery_hits"][0]["admission_outcome"] == "admitted"
    assert fourth["discovery_hits"][0]["listing"]["depositary_to_underlying_ratio"] == 3.0
    _wait_for_terminal(client, fourth["id"])

    expired = _supplementary_input(
        ticker="OLD",
        security_identifier="known-effective-end",
        effective_to="2026-07-05",
    )
    fifth = client.post(
        "/scanner-sessions", json={"supplementary_inputs": [expired]}
    ).json()
    assert fifth["discovery_hits"][0]["admission_outcome"] == "rejected"
    _wait_for_terminal(client, fifth["id"])

    omitted_effective_end = {**expired, "effective_to": None}
    sixth = client.post(
        "/scanner-sessions", json={"supplementary_inputs": [omitted_effective_end]}
    ).json()
    assert sixth["discovery_hits"][0]["admission_outcome"] == "rejected"
    assert sixth["discovery_hits"][0]["admission_reasons"] == [
        "listing_not_active_on_trading_date"
    ]


def test_supplementary_csv_records_provenance_and_unresolved_identity(scanner_client):
    client, _ = scanner_client
    csv_text = "\n".join(
        [
            "ticker,discovery_reason,security_identifier_source,security_identifier,exchange,listing_status,instrument_type,effective_from,foreign_issuer,depositary_to_underlying_ratio",
            "ABVC,CSV catalyst screen,test_registry,security-abvc,NYSE American,active,american_depositary_share,2020-01-01,true,2.5",
            "MYST,Needs identity resolution,,,,,,,,",
        ]
    )

    response = client.post(
        "/scanner-sessions/import-csv",
        files={"file": ("supplementary.csv", csv_text.encode(), "text/csv")},
    )

    assert response.status_code == 202
    hits = response.json()["discovery_hits"]
    assert [hit["source"] for hit in hits] == ["csv", "csv"]
    assert [hit["source_reference"] for hit in hits] == [
        "supplementary.csv:2",
        "supplementary.csv:3",
    ]
    assert [hit["admission_outcome"] for hit in hits] == ["admitted", "unresolved"]


def test_supplementary_csv_uses_logical_rows_for_multiline_provenance(scanner_client):
    client, _ = scanner_client
    csv_text = (
        'ticker,discovery_reason\n'
        'ALFA,"First line\nsecond line"\n'
        'BETA,Second record\n'
    )

    response = client.post(
        "/scanner-sessions/import-csv",
        files={"file": ("multiline.csv", csv_text.encode(), "text/csv")},
    )

    assert response.status_code == 202
    assert [hit["source_reference"] for hit in response.json()["discovery_hits"]] == [
        "multiline.csv:2",
        "multiline.csv:3",
    ]


def test_supplementary_inputs_reject_non_finite_ratios(scanner_client):
    client, _ = scanner_client

    response = client.post(
        "/scanner-sessions",
        json={
            "supplementary_inputs": [
                _supplementary_input(depositary_to_underlying_ratio="Infinity")
            ]
        },
    )

    assert response.status_code == 422

    csv_response = client.post(
        "/scanner-sessions/import-csv",
        files={
            "file": (
                "non-finite.csv",
                b"ticker,depositary_to_underlying_ratio\nSINT,inf\n",
                "text/csv",
            )
        },
    )
    assert csv_response.status_code == 422


def test_supplementary_csv_rejects_oversized_uploads(scanner_client):
    client, _ = scanner_client

    response = client.post(
        "/scanner-sessions/import-csv",
        files={
            "file": (
                "oversized.csv",
                b"ticker\n" + b"A" * MAX_SUPPLEMENTARY_CSV_BYTES,
                "text/csv",
            )
        },
    )

    assert response.status_code == 413


def test_supplementary_csv_applies_the_json_input_count_limit(scanner_client):
    client, _ = scanner_client
    csv_text = "ticker\n" + "\n".join(
        f"ROW{index}" for index in range(MAX_SUPPLEMENTARY_INPUTS + 1)
    )

    response = client.post(
        "/scanner-sessions/import-csv",
        files={"file": ("too-many.csv", csv_text.encode(), "text/csv")},
    )

    assert response.status_code == 422
    assert response.json()["detail"]["errors"] == [
        {
            "row": MAX_SUPPLEMENTARY_INPUTS + 2,
            "field": "rows",
            "message": f"At most {MAX_SUPPLEMENTARY_INPUTS} data rows are allowed.",
        }
    ]


@pytest.mark.parametrize(
    "scanner_client",
    [
        ControlledDiscovery(
            failure=DiscoveryUnavailable(
                code="required_discovery_unavailable",
                message="Required discovery unavailable.",
            )
        )
    ],
    indirect=True,
)
def test_supplementary_inputs_cannot_complete_without_market_movement_discovery(scanner_client):
    client, _ = scanner_client

    started = client.post(
        "/scanner-sessions",
        json={"supplementary_inputs": [_supplementary_input()]},
    ).json()
    failed = _wait_for_terminal(client, started["id"])

    assert failed["status"] == "failed"
    assert len(failed["candidates"]) == 1
    assert failed["discovery_hits"][0]["admission_outcome"] == "admitted"
    assert failed["diagnostics"][0]["code"] == "required_discovery_unavailable"


def test_shutdown_marks_in_flight_attempt_failed(scanner_database_url: str):
    engine = create_engine(scanner_database_url, pool_pre_ping=True)
    testing_session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    discovery = ControlledDiscovery(release=Event())
    scanner_sessions = ScannerSessions(
        testing_session,
        discovery_factory=lambda: discovery,
        clock=lambda: FIXED_START,
    )

    async def exercise_shutdown() -> dict:
        started = await scanner_sessions.start()
        assert await asyncio.to_thread(discovery.started.wait, 2)
        await scanner_sessions.shutdown()
        return scanner_sessions.get(started.id).model_dump(mode="json")

    failed = asyncio.run(exercise_shutdown())
    engine.dispose()

    assert failed["status"] == "failed"
    assert failed["stage"] == "failed"
    assert failed["diagnostics"][0]["status"] == "failed"
    assert failed["diagnostics"][0]["code"] == "scanner_run_interrupted"
    assert failed["diagnostics"][0]["message"] == (
        "The application stopped before required Market-Movement Discovery completed. "
        "Start a new Scanner Session."
    )


def test_recovery_does_not_interrupt_another_process_live_session(scanner_database_url: str):
    engine = create_engine(scanner_database_url, pool_pre_ping=True)
    testing_session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    release = Event()
    first_discovery = ControlledDiscovery(release=release)
    second_discovery = ControlledDiscovery()
    first_process = ScannerSessions(
        testing_session,
        discovery_factory=lambda: first_discovery,
        clock=lambda: FIXED_START,
    )
    second_process = ScannerSessions(
        testing_session,
        discovery_factory=lambda: second_discovery,
        clock=lambda: FIXED_START,
    )

    async def exercise_recovery() -> tuple[dict, dict]:
        first = await first_process.start()
        assert await asyncio.to_thread(first_discovery.started.wait, 2)
        second_process.recover_interrupted()
        repeated = await second_process.start()
        release.set()
        deadline = monotonic() + 2
        completed = first_process.get(first.id)
        while completed.status == "running" and monotonic() < deadline:
            await asyncio.sleep(0.01)
            completed = first_process.get(first.id)
        await first_process.shutdown()
        return repeated.model_dump(mode="json"), completed.model_dump(mode="json")

    repeated, completed = asyncio.run(exercise_recovery())
    engine.dispose()

    assert repeated["id"] == completed["id"]
    assert completed["status"] == "completed"
    assert first_discovery.calls == 1
    assert second_discovery.calls == 0


def test_stale_owner_is_failed_and_cannot_overwrite_terminal_attempt(
    scanner_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
):
    engine = create_engine(scanner_database_url, pool_pre_ping=True)
    testing_session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    release = Event()
    discovery = ControlledDiscovery(release=release)
    current_time = [FIXED_START]
    first_process = ScannerSessions(
        testing_session,
        discovery_factory=lambda: discovery,
        clock=lambda: current_time[0],
    )
    recovering_process = ScannerSessions(
        testing_session,
        discovery_factory=ControlledDiscovery,
        clock=lambda: current_time[0],
    )
    recovery_has_lock = Event()
    allow_recovery_to_commit = Event()
    original_mark_failed = recovering_process._mark_failed

    def pause_recovery_after_lock(*args, **kwargs):
        recovery_has_lock.set()
        assert allow_recovery_to_commit.wait(2)
        return original_mark_failed(*args, **kwargs)

    monkeypatch.setattr(recovering_process, "_mark_failed", pause_recovery_after_lock)

    async def exercise_stale_recovery() -> tuple[dict, dict]:
        started = await first_process.start()
        assert await asyncio.to_thread(discovery.started.wait, 2)
        current_time[0] = FIXED_START + timedelta(minutes=2)
        with ThreadPoolExecutor(max_workers=2) as executor:
            recovery = executor.submit(recovering_process.recover_interrupted)
            assert await asyncio.to_thread(recovery_has_lock.wait, 2)

            def finish_old_work_then_release_recovery() -> None:
                discovery.release.set()
                sleep(0.1)
                allow_recovery_to_commit.set()

            unblock = executor.submit(finish_old_work_then_release_recovery)
            await asyncio.to_thread(recovery.result, 2)
            await asyncio.to_thread(unblock.result, 2)
        recovered = recovering_process.get(started.id)
        await asyncio.sleep(0.05)
        after_old_work_returns = recovering_process.get(started.id)
        await first_process.shutdown()
        return recovered.model_dump(mode="json"), after_old_work_returns.model_dump(mode="json")

    recovered, after_old_work_returns = asyncio.run(exercise_stale_recovery())
    engine.dispose()

    assert recovered["status"] == "failed"
    assert recovered["diagnostics"][0]["code"] == "scanner_run_interrupted"
    assert after_old_work_returns == recovered


@pytest.mark.parametrize(
    ("instant", "trading_date", "market_phase"),
    [
        (datetime(2026, 7, 6, 7, 59, tzinfo=timezone.utc), "2026-07-06", "closed"),
        (datetime(2026, 7, 6, 8, 0, tzinfo=timezone.utc), "2026-07-06", "premarket"),
        (datetime(2026, 7, 6, 13, 30, tzinfo=timezone.utc), "2026-07-06", "regular"),
        (datetime(2026, 7, 6, 20, 0, tzinfo=timezone.utc), "2026-07-06", "after_hours"),
        (datetime(2026, 7, 7, 0, 0, tzinfo=timezone.utc), "2026-07-07", "closed"),
        (datetime(2026, 7, 4, 16, 0, tzinfo=timezone.utc), "2026-07-06", "closed"),
        (datetime(2026, 12, 25, 16, 0, tzinfo=timezone.utc), "2026-12-28", "closed"),
        (datetime(2026, 11, 27, 17, 59, tzinfo=timezone.utc), "2026-11-27", "regular"),
        (datetime(2026, 11, 27, 18, 0, tzinfo=timezone.utc), "2026-11-27", "after_hours"),
    ],
)
def test_exchange_session_identity_uses_new_york_calendar(
    instant: datetime,
    trading_date: str,
    market_phase: str,
):
    identity = resolve_exchange_session_identity(instant)

    assert identity.trading_date.isoformat() == trading_date
    assert identity.market_phase == market_phase
