from datetime import datetime
from functools import lru_cache

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.scanner_sessions.delayed_bars import AlpacaDelayedBarDiscovery, listing_universe
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


@lru_cache
def get_scanner_sessions() -> ScannerSessions:
    settings = get_settings()

    def discovery_factory(started_at: datetime) -> MarketMovementDiscovery:
        with SessionLocal() as db:
            universe = listing_universe(db, started_at)
        return AlpacaDelayedBarDiscovery(settings, universe, started_at=started_at)

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
