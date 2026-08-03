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

    history = client.get("/scanner-sessions").json()
    assert history[0] == completed


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
    repeated = client.post("/scanner-sessions").json()
    assert repeated["id"] == sessions[0]["id"]
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
