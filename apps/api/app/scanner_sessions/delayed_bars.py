"""Delayed consolidated discovery over a frozen, verified Listing universe.

No vendor fields escape this adapter. Missing bars are coverage diagnostics, not
zero-volume observations. A malformed or truncated response fails the whole scan.
"""
from __future__ import annotations

from collections.abc import Callable, Sequence
from datetime import datetime, timedelta, timezone
import math
from typing import Any

import httpx
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.core.config import Settings
from app.models.scanner_sessions import Listing
from app.scanner_sessions.admission import ELIGIBLE_EXCHANGES, ELIGIBLE_INSTRUMENT_TYPES
from app.scanner_sessions.domain import (
    DiscoveryProgress,
    DiscoveryResult,
    DiscoveryUnavailable,
    resolve_exchange_session_identity,
    utc_now,
)
from app.schemas.scanner_sessions import NormalizedDiscoveryHit


# Versioned discovery selection, not scoring or Research Eligibility thresholds.
DELAYED_BAR_POLICY = {
    "version": "delayed-bar-discovery-v1",
    "lookback_minutes": 60,
    "minimum_absolute_move_pct": 5,
    "minimum_volume": 100_000,
    "batch_size": 100,
    "maximum_pages_per_batch": 100,
    "expected_delay_seconds": 900,
}


def listing_universe(db: Session, instant: datetime) -> list[NormalizedDiscoveryHit]:
    trading_date = resolve_exchange_session_identity(instant).trading_date
    listings = (
        db.query(Listing)
        .options(joinedload(Listing.security))
        .filter(
            Listing.status == "active",
            Listing.exchange.in_(ELIGIBLE_EXCHANGES),
            Listing.instrument_type.in_(ELIGIBLE_INSTRUMENT_TYPES),
            Listing.effective_from <= trading_date,
            or_(Listing.effective_to.is_(None), Listing.effective_to >= trading_date),
            or_(Listing.instrument_type != "american_depositary_share", Listing.foreign_issuer.is_(True)),
        )
        .order_by(Listing.id)
        .all()
    )
    return [
        NormalizedDiscoveryHit(
            source="alpaca_delayed_bars", source_reference=f"listing:{listing.id}",
            ticker=listing.ticker, discovery_reason="Pending delayed-bar evaluation",
            security_identifier_source=listing.security.identifier_source,
            security_identifier=listing.security.identifier,
            issuer_name=listing.security.issuer_name,
            exchange=listing.exchange, listing_status=listing.status,
            instrument_type=listing.instrument_type,
            effective_from=listing.effective_from, effective_to=listing.effective_to,
            foreign_issuer=listing.foreign_issuer,
            depositary_to_underlying_ratio=listing.depositary_to_underlying_ratio,
        )
        for listing in listings
    ]


class AlpacaDelayedBarDiscovery:
    source = "alpaca_delayed_bars"

    def __init__(
        self, settings: Settings, universe: Sequence[NormalizedDiscoveryHit], *,
        client: httpx.AsyncClient | None = None,
        clock: Callable[[], datetime] = utc_now,
        started_at: datetime | None = None,
    ):
        self._settings = settings
        self._universe = tuple(universe)
        self._client = client
        self._clock = clock
        self._started_at = started_at or clock()

    async def discover(self, *, report_progress: DiscoveryProgress | None = None) -> DiscoveryResult:
        if not self._settings.alpaca_configured:
            raise DiscoveryUnavailable(code="alpaca_not_configured", message="Configure Alpaca credentials for delayed consolidated Market-Movement Discovery.")
        if self._settings.alpaca_scanner_feed != "delayed_sip":
            raise DiscoveryUnavailable(code="delayed_sip_required", message="This discovery adapter requires the delayed_sip scanner feed; IEX is not consolidated coverage.")
        if not self._universe:
            raise DiscoveryUnavailable(code="listing_universe_empty", message="No active eligible Listings in the identity registry. Populate verified Security and effective-dated Listing identities before scanning.")
        if self._client is not None:
            return await self._scan(self._client)
        async with httpx.AsyncClient(timeout=20.0) as client:
            return await self._scan(client)

    async def _scan(self, client: httpx.AsyncClient) -> DiscoveryResult:
        policy = DELAYED_BAR_POLICY
        end = self._started_at - timedelta(seconds=policy["expected_delay_seconds"])
        start = end - timedelta(minutes=policy["lookback_minutes"])
        symbols = sorted({item.ticker for item in self._universe})
        bars: dict[str, dict[datetime, tuple[float, float, float]]] = {symbol: {} for symbol in symbols}
        requests = 0
        request_ids: list[str] = []
        headers = {
            "APCA-API-KEY-ID": self._settings.alpaca_api_key_id,
            "APCA-API-SECRET-KEY": self._settings.alpaca_api_secret_key,
        }
        for offset in range(0, len(symbols), policy["batch_size"]):
            batch = symbols[offset:offset + policy["batch_size"]]
            token = None
            seen_tokens: set[str] = set()
            for _ in range(policy["maximum_pages_per_batch"]):
                params = {
                    "symbols": ",".join(batch), "timeframe": "1Min", "feed": "sip",
                    "start": start.isoformat(), "end": end.isoformat(),
                    "limit": 10000, "sort": "asc", "adjustment": "raw",
                }
                if token is not None:
                    params["page_token"] = token
                requests += 1
                response = await client.get(
                    f"{self._settings.alpaca_data_base_url.rstrip('/')}/v2/stocks/bars",
                    params=params, headers=headers,
                )
                request_id = response.headers.get("x-request-id")
                if request_id:
                    request_ids.append(request_id)
                if response.status_code in {401, 403, 404, 422}:
                    raise DiscoveryUnavailable(
                        code="delayed_bars_unavailable", message=f"Delayed consolidated bars unavailable (HTTP {response.status_code}).",
                        details={"requests": requests, "requested_symbols": len(symbols)},
                    )
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict) or not isinstance(payload.get("bars"), dict):
                    raise ValueError("Invalid delayed-bar payload: bars must be an object")
                for symbol, rows in payload["bars"].items():
                    if symbol not in batch or not isinstance(rows, list):
                        raise ValueError("Invalid delayed-bar symbol or rows")
                    for row in rows:
                        event_at, values = self._bar(row)
                        if not start <= event_at <= end:
                            raise ValueError("Provider bar outside requested delayed window")
                        previous = bars[symbol].get(event_at)
                        if previous is not None and previous != values:
                            raise ValueError("Conflicting provider bars at the same event time")
                        bars[symbol][event_at] = values
                token = payload.get("next_page_token")
                if token is None:
                    break
                if not isinstance(token, str) or not token or token in seen_tokens:
                    raise ValueError("Invalid or repeated delayed-bar pagination token")
                seen_tokens.add(token)
            else:
                raise ValueError("Delayed-bar pagination exceeded the bounded request budget")

        observed_at = self._clock()
        hits: list[NormalizedDiscoveryHit] = []
        event_times: dict[str, str] = {}
        reasons: dict[str, list[str]] = {}
        for symbol, observations in bars.items():
            if not observations:
                continue
            times = sorted(observations)
            opening = observations[times[0]][0]
            closing = observations[times[-1]][1]
            volume = sum(bar[2] for bar in observations.values())
            move_pct = (closing / opening - 1) * 100
            event_times[symbol] = times[-1].isoformat()
            reasons[symbol] = []
            if abs(move_pct) >= policy["minimum_absolute_move_pct"]:
                reasons[symbol].append(f"Market movement: {move_pct:+.2f}% first open to last close in the delayed 60-minute window")
            if volume >= policy["minimum_volume"]:
                reasons[symbol].append(f"Activity: {volume:,.0f} shares in the delayed 60-minute window")
        for listing in self._universe:
            for reason in reasons.get(listing.ticker, []):
                hits.append(listing.model_copy(update={
                    "source": self.source,
                    "source_reference": f"{listing.source_reference}:bar:{event_times[listing.ticker]}",
                    "observed_at": observed_at,
                    "discovery_reason": reason,
                    "provenance": {
                        "data_tier": "delayed_consolidated", "feed": "sip",
                        "coverage": "consolidated_us_equities",
                        "expected_delay_seconds": policy["expected_delay_seconds"],
                        "provider_event_at": event_times[listing.ticker],
                        "observed_at": observed_at.isoformat(), "request_ids": request_ids,
                    },
                }))
        return DiscoveryResult(
            records_count=len(hits), hits=tuple(hits),
            message="Delayed consolidated bars supplied Market-Movement Discovery.",
            details={
                "data_tier": "delayed_consolidated", "feed": "sip",
                "coverage": "consolidated_us_equities",
                "expected_delay_seconds": policy["expected_delay_seconds"],
                "observed_at": observed_at.isoformat(),
                "provider_event_at": max(event_times.values(), default=None),
                "provider_event_times": event_times,
                "window_start": start.isoformat(), "window_end": end.isoformat(),
                "universe": "active_eligible_listing_registry",
                "eligible_listings": len(self._universe), "requested_symbols": len(symbols),
                "symbols_with_bars": len(event_times),
                "symbols_without_bars": [symbol for symbol in symbols if not bars[symbol]],
                "requests": requests, "selection_policy": dict(policy),
            },
        )

    @staticmethod
    def _bar(row: Any) -> tuple[datetime, tuple[float, float, float]]:
        if not isinstance(row, dict):
            raise ValueError("Provider bar must be an object")
        try:
            event_at = datetime.fromisoformat(row["t"].replace("Z", "+00:00"))
            values = tuple(row[key] for key in ("o", "c", "v"))
            if event_at.tzinfo is None or any(
                isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                for value in values
            ) or values[0] <= 0 or values[1] <= 0 or values[2] < 0:
                raise ValueError("Invalid bar timestamp, price or volume")
        except (KeyError, TypeError, AttributeError) as exc:
            raise ValueError("Invalid provider bar fields") from exc
        return event_at.astimezone(timezone.utc), values
