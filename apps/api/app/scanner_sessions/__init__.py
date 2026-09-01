from functools import lru_cache

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.scanner_sessions.adapters import AlpacaMarketMovementDiscovery
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
    return ScannerSessions(
        SessionLocal,
        discovery_factory=lambda: AlpacaMarketMovementDiscovery(settings),
    )


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
