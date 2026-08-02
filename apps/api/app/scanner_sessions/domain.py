from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from typing import Any, Protocol
from zoneinfo import ZoneInfo

import exchange_calendars as exchange_calendars
import pandas as pd

from app.scanner_session_types import MarketPhase


NEW_YORK = ZoneInfo("America/New_York")
PREMARKET_OPEN = time(4)
AFTER_HOURS_CLOSE = time(20)

@dataclass(frozen=True)
class ExchangeSessionIdentity:
    trading_date: date
    market_phase: MarketPhase


@dataclass(frozen=True)
class DiscoveryResult:
    records_count: int
    message: str
    details: dict[str, Any] = field(default_factory=dict)


class DiscoveryUnavailable(RuntimeError):
    def __init__(self, *, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


class MarketMovementDiscovery(Protocol):
    source: str

    async def discover(self) -> DiscoveryResult:
        ...


def resolve_exchange_session_identity(instant: datetime) -> ExchangeSessionIdentity:
    if instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError("Scanner Session start time must include a timezone.")

    calendar = exchange_calendars.get_calendar("XNYS")
    local_start = instant.astimezone(NEW_YORK)
    local_date = local_start.date()
    calendar_date = pd.Timestamp(local_date)

    if not calendar.is_session(calendar_date):
        next_session = calendar.date_to_session(calendar_date, direction="next")
        return ExchangeSessionIdentity(next_session.date(), "closed")

    market_open = calendar.session_open(calendar_date).to_pydatetime().astimezone(NEW_YORK)
    market_close = calendar.session_close(calendar_date).to_pydatetime().astimezone(NEW_YORK)
    premarket_open = datetime.combine(local_date, PREMARKET_OPEN, tzinfo=NEW_YORK)
    after_hours_close = datetime.combine(local_date, AFTER_HOURS_CLOSE, tzinfo=NEW_YORK)

    if local_start < premarket_open:
        phase: MarketPhase = "closed"
    elif local_start < market_open:
        phase = "premarket"
    elif local_start < market_close:
        phase = "regular"
    elif local_start < after_hours_close:
        phase = "after_hours"
    else:
        next_session = calendar.next_session(calendar_date)
        return ExchangeSessionIdentity(next_session.date(), "closed")

    return ExchangeSessionIdentity(local_date, phase)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
