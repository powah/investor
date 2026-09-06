from datetime import datetime
from functools import lru_cache

from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import SessionLocal
from app.scanner_sessions.adapters import AlpacaScreenerDiscovery
from app.scanner_sessions.delayed_bars import AlpacaDelayedBarDiscovery, listing_universe
from app.scanner_sessions.selection import CapabilityAwareDiscovery, RecordedCapability
from app.services.capabilities import capability_configuration_fingerprint, latest_capability_checks
from app.scanner_sessions.domain import (
    DiscoveryResult,
    DiscoveryUnavailable,
    ExchangeSessionIdentity,
    MarketMovementDiscovery,
    resolve_exchange_session_identity,
)
from app.scanner_sessions.module import (
    ScannerSessionActive,
    ScannerSessionNotFound,
    ScannerSessions,
)


def build_discovery(db: Session, settings: Settings, started_at: datetime) -> MarketMovementDiscovery:
    universe = listing_universe(db, started_at)
    fingerprint = capability_configuration_fingerprint(settings)
    capabilities = {
        check.capability: RecordedCapability(
            status=check.status, check_id=check.id, tested_at=check.tested_at.isoformat(),
            request_id=check.request_id,
        )
        for check in latest_capability_checks(db)
        if check.provider == "alpaca"
        and settings.alpaca_configured
        and check.details.get("configuration_fingerprint") == fingerprint
    }
    return CapabilityAwareDiscovery(
        started_at=started_at, capabilities=capabilities,
        screeners={
            f"screener:{kind}": AlpacaScreenerDiscovery(settings, kind, universe)
            for kind in ("movers", "most_actives")
        },
        fallback=AlpacaDelayedBarDiscovery(settings, universe, started_at=started_at),
    )


@lru_cache
def get_scanner_sessions() -> ScannerSessions:
    settings = get_settings()

    def discovery_factory(started_at: datetime) -> MarketMovementDiscovery:
        with SessionLocal() as db:
            return build_discovery(db, settings, started_at)

    return ScannerSessions(SessionLocal, discovery_factory=discovery_factory)


__all__ = [
    "DiscoveryResult",
    "DiscoveryUnavailable",
    "ExchangeSessionIdentity",
    "MarketMovementDiscovery",
    "ScannerSessionActive",
    "ScannerSessionNotFound",
    "ScannerSessions",
    "get_scanner_sessions",
    "resolve_exchange_session_identity",
]
