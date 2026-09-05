from __future__ import annotations

import asyncio
from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Mapping
from uuid import uuid4

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.models.scanner_sessions import (
    DiscoveryHit,
    Listing,
    ScannerSession,
    ScannerSessionCandidate,
    ScannerSessionDiagnostic,
    Security,
)
from app.scanner_session_types import ScannerSessionDiagnosticStatus
from app.scanner_sessions.admission import admit_discovery_hits
from app.scanner_sessions.domain import (
    DiscoveryResult,
    DiscoveryUnavailable,
    MarketMovementDiscovery,
    resolve_exchange_session_identity,
    utc_now,
)
from app.schemas.scanner_sessions import (
    CandidateRead,
    DiscoveryHitRead,
    ListingObservationRead,
    ListingRead,
    ScannerSessionDiagnosticRead,
    ScannerSessionProgressRead,
    ScannerSessionRead,
    ScannerSessionSummaryRead,
    SecurityRead,
    SupplementaryDiscoveryInput,
)


SCANNER_POLICY_VERSION = "scanner-policy-v1"
SCORING_MODEL_VERSION = "scoring-model-v1"
SCANNER_SESSION_LEASE_SECONDS = 60
SCANNER_SESSION_HEARTBEAT_SECONDS = 10
SCANNER_POLICY_SETTINGS: dict[str, Any] = {
    "market_cap_ceiling_usd": 2_000_000_000,
    "minimum_price_usd": 1,
    "required_sources": ["market_movement"],
    "currentness_max_age_seconds": 900,
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


class ScannerSessionActive(RuntimeError):
    def __init__(self, session_id: int):
        self.session_id = session_id
        super().__init__(
            f"Scanner Session {session_id} is already running; supplementary inputs "
            "were not accepted."
        )


class _ScannerRunOwnershipLost(RuntimeError):
    pass


class ScannerSessions:
    def __init__(
        self,
        session_factory: Callable[[], Session],
        *,
        discovery_factory: Callable[[datetime], MarketMovementDiscovery],
        clock: Callable[[], datetime] = utc_now,
        supplementary_factories: Mapping[str, Callable[[datetime], MarketMovementDiscovery]] | None = None,
        policy_settings: Mapping[str, Any] | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._discovery_factory = discovery_factory
        self._clock = clock
        self._supplementary_factories = dict(supplementary_factories or {})
        if "market_movement" in self._supplementary_factories:
            raise ValueError("Supplementary sources cannot replace Market-Movement Discovery")
        self._policy_settings = deepcopy(dict(SCANNER_POLICY_SETTINGS))
        if policy_settings is not None:
            self._policy_settings.update(deepcopy(dict(policy_settings)))
        required = set(self._policy_settings["required_sources"])
        if "market_movement" not in required or required - {"market_movement", *self._supplementary_factories}:
            raise ValueError("Required discovery sources must be configured, including market_movement")
        self._runs: dict[int, asyncio.Task[None]] = {}
        self._owner_id = uuid4().hex
        self._tasks: set[asyncio.Task[None]] = set()

    async def start(
        self,
        supplementary_inputs: list[SupplementaryDiscoveryInput] | None = None,
    ) -> ScannerSessionRead:
        self.recover_interrupted()
        with self._session_factory() as db:
            active = self._active(db)
            if active is not None:
                if supplementary_inputs:
                    raise ScannerSessionActive(active.id)
                return self._read(active)

            started_at = self._clock()
            identity = resolve_exchange_session_identity(started_at)
            discovery = self._discovery_factory(started_at)
            sources = {"market_movement": discovery, **{
                capability: factory(started_at)
                for capability, factory in self._supplementary_factories.items()
            }}
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
                scanner_policy_settings=deepcopy(self._policy_settings),
                scoring_model_version=SCORING_MODEL_VERSION,
                progress_completed=0,
                progress_total=len(sources),
                diagnostics=[
                    ScannerSessionDiagnostic(
                        source=source.source,
                        capability=capability,
                        required=capability in self._policy_settings["required_sources"],
                        status="pending",
                        records_count=0,
                        details={},
                    )
                    for capability, source in sources.items()
                ],
            )
            db.add(session)
            try:
                db.flush()
                admit_discovery_hits(
                    db,
                    session=session,
                    inputs=supplementary_inputs or [],
                    observed_at=started_at,
                )
                db.commit()
            except IntegrityError:
                db.rollback()
                active = self._active(db)
                if active is None:
                    raise
                if supplementary_inputs:
                    raise ScannerSessionActive(active.id)
                return self._read(active)
            db.refresh(session)
            session_id = session.id
            result = self._read(self._by_id(db, session_id))

        task = asyncio.create_task(self._run(session_id, sources))
        self._runs[session_id] = task
        task.add_done_callback(lambda _: self._runs.pop(session_id, None))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return result

    def list(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> list[ScannerSessionSummaryRead]:
        self.recover_interrupted()
        with self._session_factory() as db:
            diagnostics_count = (
                db.query(func.count(ScannerSessionDiagnostic.id))
                .filter(ScannerSessionDiagnostic.scanner_session_id == ScannerSession.id)
                .correlate(ScannerSession)
                .scalar_subquery()
            )
            discovery_hits_count = (
                db.query(func.count(DiscoveryHit.id))
                .filter(DiscoveryHit.scanner_session_id == ScannerSession.id)
                .correlate(ScannerSession)
                .scalar_subquery()
            )
            candidates_count = (
                db.query(func.count(ScannerSessionCandidate.id))
                .filter(ScannerSessionCandidate.scanner_session_id == ScannerSession.id)
                .correlate(ScannerSession)
                .scalar_subquery()
            )
            rows = (
                db.query(
                    ScannerSession,
                    diagnostics_count.label("diagnostics_count"),
                    discovery_hits_count.label("discovery_hits_count"),
                    candidates_count.label("candidates_count"),
                )
                .order_by(ScannerSession.started_at.desc(), ScannerSession.id.desc())
                .offset(offset)
                .limit(limit)
                .all()
            )
            return [
                self._summary_read(
                    session,
                    diagnostics_count=diagnostic_total,
                    discovery_hits_count=hit_total,
                    candidates_count=candidate_total,
                )
                for session, diagnostic_total, hit_total, candidate_total in rows
            ]

    def get(self, session_id: int) -> ScannerSessionRead:
        self.recover_interrupted()
        with self._session_factory() as db:
            return self._read(self._by_id(db, session_id))

    def current(self) -> ScannerSessionRead | None:
        self.recover_interrupted()
        now = self._clock()
        identity = resolve_exchange_session_identity(now)
        if identity.market_phase == "closed":
            return None
        with self._session_factory() as db:
            sessions = (
                db.query(ScannerSession)
                .options(*self._load_options())
                .filter(
                    ScannerSession.status == "completed",
                    ScannerSession.trading_date == identity.trading_date,
                    ScannerSession.market_phase == identity.market_phase,
                )
                .order_by(ScannerSession.started_at.desc(), ScannerSession.id.desc())
            )
            for session in sessions:
                max_age = session.scanner_policy_settings.get("currentness_max_age_seconds", 900)
                if timedelta(0) <= now - session.started_at <= timedelta(seconds=max_age):
                    return self._read(session)
        return None

    async def cancel(self, session_id: int) -> ScannerSessionRead:
        with self._session_factory() as db:
            session = (
                db.query(ScannerSession).options(*self._load_options())
                .filter(ScannerSession.id == session_id).with_for_update().one_or_none()
            )
            if session is None:
                raise ScannerSessionNotFound(f"Scanner Session {session_id} was not found.")
            if session.status == "running":
                session.status = "cancelled"
                session.stage = "cancelled"
                session.completed_at = self._clock()
                session.active_slot = None
                for diagnostic in session.diagnostics:
                    if diagnostic.status in {"pending", "running"}:
                        diagnostic.status = "skipped"
                        diagnostic.code = "operator_cancelled"
                        diagnostic.message = "Cancelled by the operator."
                        diagnostic.completed_at = session.completed_at
                db.commit()
            result = self._read(session)
        task = self._runs.get(session_id)
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        return result

    def recover_interrupted(self) -> None:
        completed_at = self._clock()
        stale_before = completed_at - timedelta(seconds=SCANNER_SESSION_LEASE_SECONDS)
        with self._session_factory() as db:
            active = (
                db.query(ScannerSession)
                .options(*self._load_options())
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
        # A task cancelled before its coroutine starts cannot run its cleanup.
        with self._session_factory() as db:
            active = (
                db.query(ScannerSession).options(*self._load_options())
                .filter(ScannerSession.active_slot.is_(True), ScannerSession.owner_id == self._owner_id)
                .with_for_update().one_or_none()
            )
            if active is not None:
                self._mark_failed(active, failure=_INTERRUPTED_FAILURE, completed_at=self._clock())
                db.commit()

    async def _run(self, session_id: int, sources: Mapping[str, MarketMovementDiscovery]) -> None:
        try:
            for capability, discovery in sources.items():
                with self._session_factory() as db:
                    session = self._owned_active(db, session_id, for_update=True)
                    if session is None:
                        return
                    diagnostic = next(d for d in session.diagnostics if d.capability == capability)
                    session.stage = "market_movement_discovery"
                    session.heartbeat_at = self._clock()
                    diagnostic.status = "running"
                    diagnostic.started_at = self._clock()
                    db.commit()
                try:
                    result = await self._discover_with_heartbeat(session_id, discovery)
                    result.validate()
                    self._finish_source(session_id, capability, result=result)
                except DiscoveryUnavailable as exc:
                    self._finish_source(session_id, capability, failure=_ScannerRunFailure(
                        "unavailable", exc.code, exc.message, exc.details,
                    ))
                except (_ScannerRunOwnershipLost, asyncio.CancelledError):
                    raise
                except Exception as exc:
                    self._finish_source(session_id, capability, failure=_ScannerRunFailure(
                        "failed", f"{capability}_discovery_failed",
                        f"Discovery failed: {type(exc).__name__}: {str(exc)[:1000]}", {},
                    ))
        except _ScannerRunOwnershipLost:
            return
        except asyncio.CancelledError:
            self._finish_failed(session_id, _INTERRUPTED_FAILURE)
        except Exception:
            self._finish_failed(session_id, _INTERRUPTED_FAILURE)

    def _finish_source(
        self, session_id: int, capability: str, *,
        result: DiscoveryResult | None = None, failure: _ScannerRunFailure | None = None,
    ) -> None:
        completed_at = self._clock()
        with self._session_factory() as db:
            session = self._owned_active(db, session_id, for_update=True)
            if session is None:
                return
            diagnostic = next(d for d in session.diagnostics if d.capability == capability)
            if result is not None:
                admit_discovery_hits(db, session=session, inputs=result.hits, observed_at=completed_at)
                diagnostic.status = "completed"
                diagnostic.records_count = result.records_count
                diagnostic.message = result.message
                diagnostic.details = result.details
            else:
                assert failure is not None
                diagnostic.status = failure.diagnostic_status
                diagnostic.code = failure.code
                diagnostic.message = failure.message
                diagnostic.details = dict(failure.details)
            diagnostic.completed_at = completed_at
            session.progress_completed += 1
            if session.progress_completed == session.progress_total:
                required_failed = any(d.required and d.status != "completed" for d in session.diagnostics)
                session.status = ("partial" if session.candidates else "failed") if required_failed else "completed"
                session.stage = session.status
                session.completed_at = completed_at
                session.active_slot = None
            # The completed status is the promotion marker: candidates and status
            # become visible together, and current() never reads running attempts.
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
        for diagnostic in session.diagnostics:
            if diagnostic.status not in {"pending", "running"}:
                continue
            diagnostic.status = failure.diagnostic_status
            diagnostic.code = failure.code
            diagnostic.message = failure.message
            diagnostic.details = dict(failure.details)
            diagnostic.completed_at = completed_at
        required_failed = any(d.required and d.status != "completed" for d in session.diagnostics)
        session.status = ("partial" if session.candidates else "failed") if required_failed else "completed"
        session.stage = session.status
        session.completed_at = completed_at
        session.active_slot = None

    @classmethod
    def _active(cls, db: Session) -> ScannerSession | None:
        return (
            db.query(ScannerSession)
            .options(*cls._load_options())
            .filter(ScannerSession.active_slot.is_(True))
            .one_or_none()
        )

    @classmethod
    def _by_id(cls, db: Session, session_id: int) -> ScannerSession:
        session = (
            db.query(ScannerSession)
            .options(*cls._load_options())
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
            .options(*self._load_options())
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
    def _load_options() -> tuple[Any, ...]:
        return (
            selectinload(ScannerSession.diagnostics),
            selectinload(ScannerSession.discovery_hits).selectinload(DiscoveryHit.security),
            selectinload(ScannerSession.discovery_hits).selectinload(DiscoveryHit.listing),
            selectinload(ScannerSession.candidates).selectinload(ScannerSessionCandidate.security),
            selectinload(ScannerSession.candidates)
            .selectinload(ScannerSessionCandidate.discovery_hits)
            .selectinload(DiscoveryHit.listing),
        )

    @staticmethod
    def _security_read(security: Security) -> SecurityRead:
        return SecurityRead(
            id=security.id,
            identifier_source=security.identifier_source,
            identifier=security.identifier,
            issuer_name=security.issuer_name,
        )

    @staticmethod
    def _listing_read(listing: Listing) -> ListingRead:
        return ListingRead(
            id=listing.id,
            security_id=listing.security_id,
            ticker=listing.ticker,
            exchange=listing.exchange,
            status=listing.status,
            instrument_type=listing.instrument_type,
            effective_from=listing.effective_from,
            effective_to=listing.effective_to,
            foreign_issuer=listing.foreign_issuer,
            depositary_to_underlying_ratio=listing.depositary_to_underlying_ratio,
        )

    @staticmethod
    def _summary_read(
        session: ScannerSession,
        *,
        diagnostics_count: int,
        discovery_hits_count: int,
        candidates_count: int,
    ) -> ScannerSessionSummaryRead:
        total = session.progress_total
        percent = round((session.progress_completed / total) * 100) if total else 0
        return ScannerSessionSummaryRead(
            id=session.id,
            status=session.status,
            stage=session.stage,
            started_at=session.started_at,
            completed_at=session.completed_at,
            trading_date=session.trading_date,
            market_phase=session.market_phase,
            scanner_policy_version=session.scanner_policy_version,
            scoring_model_version=session.scoring_model_version,
            progress=ScannerSessionProgressRead(
                completed=session.progress_completed,
                total=total,
                percent=percent,
            ),
            diagnostics_count=diagnostics_count,
            discovery_hits_count=discovery_hits_count,
            candidates_count=candidates_count,
        )

    @classmethod
    def _read(cls, session: ScannerSession) -> ScannerSessionRead:
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
            discovery_hits=[
                DiscoveryHitRead(
                    id=hit.id,
                    source=hit.source,
                    source_reference=hit.source_reference,
                    observed_at=hit.observed_at,
                    ticker=hit.ticker,
                    discovery_reason=hit.discovery_reason,
                    observed_listing=cls._listing_observation_read(hit),
                    admission_outcome=hit.admission_outcome,
                    admission_reasons=hit.admission_reasons,
                    security=cls._security_read(hit.security) if hit.security else None,
                    listing=cls._listing_read(hit.listing) if hit.listing else None,
                    candidate_id=hit.candidate_id,
                )
                for hit in session.discovery_hits
            ],
            candidates=[cls._candidate_read(candidate) for candidate in session.candidates],
        )

    @staticmethod
    def _listing_observation_read(hit: DiscoveryHit) -> ListingObservationRead:
        return ListingObservationRead(
            ticker=hit.ticker,
            exchange=hit.observed_exchange,
            status=hit.observed_listing_status,
            instrument_type=hit.observed_instrument_type,
            effective_from=hit.observed_effective_from,
            effective_to=hit.observed_effective_to,
            foreign_issuer=hit.observed_foreign_issuer,
            depositary_to_underlying_ratio=hit.observed_depositary_to_underlying_ratio,
        )

    @classmethod
    def _candidate_read(cls, candidate: ScannerSessionCandidate) -> CandidateRead:
        listings: list[ListingRead] = []
        listing_snapshots: set[tuple[object, ...]] = set()
        sources: list[str] = []
        reasons: list[str] = []
        for hit in candidate.discovery_hits:
            if hit.listing_id is not None:
                observation = cls._listing_observation_read(hit).model_dump()
                snapshot_key = (hit.listing_id, *observation.values())
                if snapshot_key not in listing_snapshots:
                    listings.append(
                        ListingRead(
                            id=hit.listing_id,
                            security_id=candidate.security_id,
                            **observation,
                        )
                    )
                    listing_snapshots.add(snapshot_key)
            if hit.source not in sources:
                sources.append(hit.source)
            if hit.discovery_reason not in reasons:
                reasons.append(hit.discovery_reason)
        return CandidateRead(
            id=candidate.id,
            security=cls._security_read(candidate.security),
            observed_listings=listings,
            discovery_hit_ids=[hit.id for hit in candidate.discovery_hits],
            discovery_sources=sources,
            discovery_reasons=reasons,
        )
