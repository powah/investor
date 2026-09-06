"""Alpaca screener payload normalization; one hit per provider occurrence."""
from __future__ import annotations

from collections.abc import Callable, Sequence
from datetime import datetime, timezone
import math

import httpx

from app.core.config import Settings
from app.scanner_sessions.domain import DiscoveryProgress, DiscoveryResult, DiscoveryUnavailable, utc_now
from app.schemas.scanner_sessions import NormalizedDiscoveryHit


class AlpacaScreenerDiscovery:
    def __init__(
        self, settings: Settings, kind: str, universe: Sequence[NormalizedDiscoveryHit], *,
        client: httpx.AsyncClient | None = None, clock: Callable[[], datetime] = utc_now,
    ):
        if kind not in {"movers", "most_actives"}:
            raise ValueError("Unknown screener")
        self.source = f"alpaca_{kind}"
        self._kind = kind
        self._settings = settings
        self._universe = tuple(universe)
        self._client = client
        self._clock = clock

    async def discover(self, *, report_progress: DiscoveryProgress | None = None) -> DiscoveryResult:
        if self._client is None:
            async with httpx.AsyncClient(timeout=20.0) as client:
                return await self._request(client)
        return await self._request(self._client)

    async def _request(self, client: httpx.AsyncClient) -> DiscoveryResult:
        endpoint = f"/v1beta1/screener/stocks/{self._kind.replace('_', '-')}"
        response = await client.get(
            f"{self._settings.alpaca_data_base_url.rstrip('/')}{endpoint}",
            params={"top": 50}, headers={
                "APCA-API-KEY-ID": self._settings.alpaca_api_key_id,
                "APCA-API-SECRET-KEY": self._settings.alpaca_api_secret_key,
            },
        )
        observed_at = self._clock()
        metadata = {
            "request_id": next((response.headers[h] for h in
                ("x-request-id", "request-id", "x-amzn-requestid") if h in response.headers), None),
            "endpoint": endpoint, "http_status": response.status_code,
            "observed_at": observed_at.isoformat(),
            "feed": "sip", "coverage": "consolidated_us_equities",
            # Screeners are not the delayed-bar contract. Do not invent an SLA.
            "data_tier": "screener_consolidated", "expected_delay_seconds": None,
        }
        if not response.is_success:
            raise DiscoveryUnavailable(
                code="screener_unavailable", message=f"{self.source}: HTTP {response.status_code}",
                details=metadata,
            )
        try:
            payload = response.json()
            if not isinstance(payload, dict):
                raise ValueError("response must be an object")
            event_at = datetime.fromisoformat(payload["last_updated"].replace("Z", "+00:00"))
            if event_at.tzinfo is None or event_at > observed_at:
                raise ValueError("invalid last_updated timestamp")
            event_at = event_at.astimezone(timezone.utc)
            metadata["provider_event_at"] = event_at.isoformat()
            groups = ("most_actives",) if self._kind == "most_actives" else ("gainers", "losers")
            hits = []
            for group in groups:
                rows = payload[group]
                if not isinstance(rows, list):
                    raise ValueError(f"{group} must be an array")
                for rank, row in enumerate(rows, 1):
                    ticker = row["symbol"].strip().upper()
                    metric = row["volume"] if group == "most_actives" else row["percent_change"]
                    if not ticker or isinstance(metric, bool) or not isinstance(metric, (float, int)) or not math.isfinite(metric):
                        raise ValueError("invalid screener symbol or metric")
                    if group == "most_actives" and metric < 0:
                        raise ValueError("negative volume")
                    reason = (f"Most active: {metric:,.0f} shares (rank {rank})" if group == "most_actives"
                              else f"Mover {group}: {metric:+.2f}% (rank {rank})")
                    matches = [item for item in self._universe if item.ticker == ticker]
                    # Ambiguous ticker identity must not be guessed into a Candidate.
                    identity = matches[0].model_dump() if len(matches) == 1 else {}
                    hits.append(NormalizedDiscoveryHit(**(identity | {
                        "source": self.source, "ticker": ticker,
                        "source_reference": f"{endpoint}:{group}:{rank}:{ticker}:{event_at.isoformat()}",
                        "observed_at": observed_at, "discovery_reason": reason,
                        "provenance": metadata,
                    })))
        except (KeyError, TypeError, ValueError, AttributeError) as exc:
            raise DiscoveryUnavailable(
                code="invalid_screener_payload", message=f"Invalid {self.source} payload: {exc}",
                details=metadata,
            ) from exc
        return DiscoveryResult(
            records_count=len(hits), hits=tuple(hits), details=metadata,
            message=f"{self.source} supplied Market-Movement Discovery.",
        )
