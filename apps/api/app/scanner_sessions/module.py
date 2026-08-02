from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Mapping
from uuid import uuid4

from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models.scanner_sessions import ScannerSession, ScannerSessionDiagnostic
from app.scanner_session_types import ScannerSessionDiagnosticStatus
from app.scanner_sessions.domain import (
    DiscoveryResult,
    DiscoveryUnavailable,
    MarketMovementDiscovery,
    resolve_exchange_session_identity,
    utc_now,
)
from app.schemas.scanner_sessions import (
    ScannerSessionDiagnosticRead,
    ScannerSessionProgressRead,
    ScannerSessionRead,
)


SCANNER_POLICY_VERSION = "scanner-policy-v1"
SCORING_MODEL_VERSION = "scoring-model-v1"
SCANNER_SESSION_LEASE_SECONDS = 60
SCANNER_SESSION_HEARTBEAT_SECONDS = 10
SCANNER_POLICY_SETTINGS: dict[str, Any] = {
    "market_cap_ceiling_usd": 2_000_000_000,
    "minimum_price_usd": 1,
    "required_sources": ["market_movement"],
}


@dataclass(frozen=True)
class _ScannerRunFailure:
    diagnostic_status: ScannerSessionDiagnosticStatus
    code: str
    message: str
    details: Mapping[str, Any]


_INTERRUPTED_FAILURE = _ScannerRunFailure(
    diagnostic_status="failed",
    code="scanner_run_interrupted",
    message=(
        "The application stopped before required Market-Movement Discovery completed. "
        "Start a new Scanner Session."
    ),
    details={},
)


class ScannerSessionNotFound(LookupError):
    pass


class _ScannerRunOwnershipLost(RuntimeError):
    pass


class ScannerSessions:
    def __init__(
        self,
        session_factory: Callable[[], Session],
        *,
        discovery_factory: Callable[[], MarketMovementDiscovery],
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._session_factory = session_factory
        self._discovery_factory = discovery_factory
        self._clock = clock
        self._owner_id = uuid4().hex
        self._tasks: set[asyncio.Task[None]] = set()

    async def start(self) -> ScannerSessionRead:
        self.recover_interrupted()
        with self._session_factory() as db:
            active = self._active(db)
            if active is not None:
                return self._read(active)

            started_at = self._clock()
            identity = resolve_exchange_session_identity(started_at)
            discovery = self._discovery_factory()
            session = ScannerSession(
                status="running",
                stage="starting",
                active_slot=True,
                owner_id=self._owner_id,
                heartbeat_at=started_at,
                started_at=started_at,
                trading_date=identity.trading_date,
                market_phase=identity.market_phase,
                scanner_policy_version=SCANNER_POLICY_VERSION,
                scanner_policy_settings=dict(SCANNER_POLICY_SETTINGS),
                scoring_model_version=SCORING_MODEL_VERSION,
                progress_completed=0,
                progress_total=1,
                diagnostics=[
                    ScannerSessionDiagnostic(
                        source=discovery.source,
                        capability="market_movement",
                        required=True,
                        status="pending",
                        records_count=0,
                        details={},
                    )
                ],
            )
            db.add(session)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                active = self._active(db)
                if active is None:
                    raise
                return self._read(active)
            db.refresh(session)
            session_id = session.id
            result = self._read(self._by_id(db, session_id))

        task = asyncio.create_task(self._run(session_id, discovery))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return result

    def list(self) -> list[ScannerSessionRead]:
        self.recover_interrupted()
        with self._session_factory() as db:
            sessions = (
                db.query(ScannerSession)
                .options(selectinload(ScannerSession.diagnostics))
                .order_by(ScannerSession.started_at.desc(), ScannerSession.id.desc())
                .all()
            )
            return [self._read(session) for session in sessions]

    def get(self, session_id: int) -> ScannerSessionRead:
        self.recover_interrupted()
        with self._session_factory() as db:
            return self._read(self._by_id(db, session_id))

    def recover_interrupted(self) -> None:
        completed_at = self._clock()
        stale_before = completed_at - timedelta(seconds=SCANNER_SESSION_LEASE_SECONDS)
        with self._session_factory() as db:
            active = (
                db.query(ScannerSession)
                .options(selectinload(ScannerSession.diagnostics))
                .filter(
                    ScannerSession.active_slot.is_(True),
                    or_(
                        ScannerSession.heartbeat_at.is_(None),
                        ScannerSession.heartbeat_at < stale_before,
                    ),
                )
                .with_for_update(skip_locked=True)
                .one_or_none()
            )
            if active is None:
                return
            self._mark_failed(
                active,
                failure=_INTERRUPTED_FAILURE,
                completed_at=completed_at,
            )
            db.commit()

    async def shutdown(self) -> None:
        tasks = tuple(self._tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _run(self, session_id: int, discovery: MarketMovementDiscovery) -> None:
        with self._session_factory() as db:
            session = self._owned_active(db, session_id)
            if session is None:
                return
            diagnostic = session.diagnostics[0]
            session.stage = "market_movement_discovery"
            session.heartbeat_at = self._clock()
            diagnostic.status = "running"
            diagnostic.started_at = self._clock()
            db.commit()

        try:
            result = await self._discover_with_heartbeat(session_id, discovery)
        except _ScannerRunOwnershipLost:
            return
        except asyncio.CancelledError:
            self._finish_failed(session_id, _INTERRUPTED_FAILURE)
        except DiscoveryUnavailable as exc:
            self._finish_failed(
                session_id,
                _ScannerRunFailure(
                    diagnostic_status="unavailable",
                    code=exc.code,
                    message=exc.message,
                    details=exc.details,
                ),
            )
        except Exception as exc:
            self._finish_failed(
                session_id,
                _ScannerRunFailure(
                    diagnostic_status="failed",
                    code="market_movement_discovery_failed",
                    message=(
                        "Market-Movement Discovery failed: "
                        f"{type(exc).__name__}: {str(exc)[:1000]}"
                    ),
                    details={},
                ),
            )
        else:
            completed_at = self._clock()
            with self._session_factory() as db:
                session = self._owned_active(db, session_id, for_update=True)
                if session is None:
                    return
                diagnostic = session.diagnostics[0]
                diagnostic.status = "completed"
                diagnostic.records_count = result.records_count
                diagnostic.message = result.message
                diagnostic.details = result.details
                diagnostic.completed_at = completed_at
                session.status = "completed"
                session.stage = "completed"
                session.progress_completed = 1
                session.completed_at = completed_at
                session.active_slot = None
                db.commit()

    async def _discover_with_heartbeat(
        self,
        session_id: int,
        discovery: MarketMovementDiscovery,
    ) -> DiscoveryResult:
        discovery_task = asyncio.create_task(discovery.discover())
        try:
            while True:
                done, _ = await asyncio.wait(
                    {discovery_task},
                    timeout=SCANNER_SESSION_HEARTBEAT_SECONDS,
                )
                if discovery_task in done:
                    return await discovery_task
                if not self._heartbeat(session_id):
                    raise _ScannerRunOwnershipLost
        finally:
            if not discovery_task.done():
                discovery_task.cancel()
                await asyncio.gather(discovery_task, return_exceptions=True)

    def _heartbeat(self, session_id: int) -> bool:
        with self._session_factory() as db:
            updated = (
                db.query(ScannerSession)
                .filter(
                    ScannerSession.id == session_id,
                    ScannerSession.active_slot.is_(True),
                    ScannerSession.owner_id == self._owner_id,
                )
                .update(
                    {ScannerSession.heartbeat_at: self._clock()},
                    synchronize_session=False,
                )
            )
            db.commit()
            return updated == 1

    def _finish_failed(
        self,
        session_id: int,
        failure: _ScannerRunFailure,
    ) -> None:
        completed_at = self._clock()
        with self._session_factory() as db:
            session = self._owned_active(db, session_id, for_update=True)
            if session is None:
                return
            self._mark_failed(
                session,
                failure=failure,
                completed_at=completed_at,
            )
            db.commit()

    @staticmethod
    def _mark_failed(
        session: ScannerSession,
        *,
        failure: _ScannerRunFailure,
        completed_at: datetime,
    ) -> None:
        diagnostic = session.diagnostics[0]
        diagnostic.status = failure.diagnostic_status
        diagnostic.code = failure.code
        diagnostic.message = failure.message
        diagnostic.details = dict(failure.details)
        diagnostic.completed_at = completed_at
        session.status = "failed"
        session.stage = "failed"
        session.completed_at = completed_at
        session.active_slot = None

    @staticmethod
    def _active(db: Session) -> ScannerSession | None:
        return (
            db.query(ScannerSession)
            .options(selectinload(ScannerSession.diagnostics))
            .filter(ScannerSession.active_slot.is_(True))
            .one_or_none()
        )

    @staticmethod
    def _by_id(db: Session, session_id: int) -> ScannerSession:
        session = (
            db.query(ScannerSession)
            .options(selectinload(ScannerSession.diagnostics))
            .filter(ScannerSession.id == session_id)
            .one_or_none()
        )
        if session is None:
            raise ScannerSessionNotFound(f"Scanner Session {session_id} was not found.")
        return session

    def _owned_active(
        self,
        db: Session,
        session_id: int,
        *,
        for_update: bool = False,
    ) -> ScannerSession | None:
        query = (
            db.query(ScannerSession)
            .options(selectinload(ScannerSession.diagnostics))
            .filter(
                ScannerSession.id == session_id,
                ScannerSession.active_slot.is_(True),
                ScannerSession.owner_id == self._owner_id,
            )
        )
        if for_update:
            query = query.with_for_update()
        return query.one_or_none()

    @staticmethod
    def _read(session: ScannerSession) -> ScannerSessionRead:
        total = session.progress_total
        percent = round((session.progress_completed / total) * 100) if total else 0
        return ScannerSessionRead(
            id=session.id,
            status=session.status,
            stage=session.stage,
            started_at=session.started_at,
            completed_at=session.completed_at,
            trading_date=session.trading_date,
            market_phase=session.market_phase,
            scanner_policy_version=session.scanner_policy_version,
            scanner_policy_settings=session.scanner_policy_settings,
            scoring_model_version=session.scoring_model_version,
            progress=ScannerSessionProgressRead(
                completed=session.progress_completed,
                total=total,
                percent=percent,
            ),
            diagnostics=[
                ScannerSessionDiagnosticRead(
                    source=diagnostic.source,
                    capability=diagnostic.capability,
                    required=diagnostic.required,
                    status=diagnostic.status,
                    records_count=diagnostic.records_count,
                    code=diagnostic.code,
                    message=diagnostic.message,
                    details=diagnostic.details,
                    started_at=diagnostic.started_at,
                    completed_at=diagnostic.completed_at,
                )
                for diagnostic in session.diagnostics
            ],
        )
