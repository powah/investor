"""Read-only Alpaca endpoint and feed capability probing."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping, Optional

import httpx


@dataclass(frozen=True)
class AlpacaCapabilityResult:
    capability: str
    endpoint: str
    source_feed: Optional[str]
    status: str
    http_status: Optional[int]
    request_id: Optional[str]
    message: str
    details: dict[str, Any]
    tested_at: datetime


@dataclass(frozen=True)
class _ProbeSpec:
    capability: str
    base_url: str
    endpoint: str
    source_feed: Optional[str] = None
    params: Optional[Mapping[str, str | int]] = None


class AlpacaCapabilityProbe:
    """Tests configured Alpaca read endpoints without placing or changing orders."""

    def __init__(
        self,
        api_key: str,
        api_secret: str,
        *,
        data_base_url: str,
        trading_base_url: str,
        client: Optional[httpx.AsyncClient] = None,
        timeout_seconds: float = 10.0,
    ) -> None:
        self._api_key = api_key.strip()
        self._api_secret = api_secret.strip()
        if not self._api_key or not self._api_secret:
            raise ValueError("Alpaca credentials are required for a capability probe.")
        self._data_base_url = data_base_url.rstrip("/")
        self._trading_base_url = trading_base_url.rstrip("/")
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=timeout_seconds)

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def probe(self, *, scanner_feed: str, execution_feed: str) -> tuple[AlpacaCapabilityResult, ...]:
        specs = (
            _ProbeSpec(
                capability=f"market_data:{scanner_feed}",
                base_url=self._data_base_url,
                endpoint="/v2/stocks/snapshots",
                source_feed=scanner_feed,
                params={"symbols": "SPY", "feed": scanner_feed},
            ),
            _ProbeSpec(
                capability=f"market_data:{execution_feed}",
                base_url=self._data_base_url,
                endpoint="/v2/stocks/snapshots",
                source_feed=execution_feed,
                params={"symbols": "SPY", "feed": execution_feed},
            ),
            _ProbeSpec(
                capability="news",
                base_url=self._data_base_url,
                endpoint="/v1beta1/news",
                params={"limit": 1},
            ),
            _ProbeSpec(
                capability="screener:most_actives",
                base_url=self._data_base_url,
                endpoint="/v1beta1/screener/stocks/most-actives",
                source_feed="sip",
                params={"top": 1},
            ),
            _ProbeSpec(
                capability="screener:movers",
                base_url=self._data_base_url,
                endpoint="/v1beta1/screener/stocks/movers",
                source_feed="sip",
                params={"top": 1},
            ),
            _ProbeSpec(
                capability="paper_account",
                base_url=self._trading_base_url,
                endpoint="/v2/account",
            ),
        )
        unique_specs = {spec.capability: spec for spec in specs}
        return tuple(
            await asyncio.gather(*(self._probe_one(spec) for spec in unique_specs.values()))
        )

    async def _probe_one(self, spec: _ProbeSpec) -> AlpacaCapabilityResult:
        tested_at = datetime.now(timezone.utc)
        url = f"{spec.base_url}{spec.endpoint}"
        try:
            response = await self._client.get(
                url,
                params=spec.params,
                headers={
                    "APCA-API-KEY-ID": self._api_key,
                    "APCA-API-SECRET-KEY": self._api_secret,
                    "Accept": "application/json",
                },
            )
        except httpx.HTTPError as exc:
            return AlpacaCapabilityResult(
                capability=spec.capability,
                endpoint=spec.endpoint,
                source_feed=spec.source_feed,
                status="failed",
                http_status=None,
                request_id=None,
                message=f"Endpoint check failed: {type(exc).__name__}.",
                details={},
                tested_at=tested_at,
            )

        request_id = _request_id(response)
        message = _response_message(response)
        if 200 <= response.status_code < 300:
            status = "available"
            message = "Read access verified."
        elif response.status_code in {401, 403, 404, 422}:
            status = "unavailable"
        else:
            status = "failed"
        return AlpacaCapabilityResult(
            capability=spec.capability,
            endpoint=spec.endpoint,
            source_feed=spec.source_feed,
            status=status,
            http_status=response.status_code,
            request_id=request_id,
            message=message,
            details={"method": "GET"},
            tested_at=tested_at,
        )


def _request_id(response: httpx.Response) -> Optional[str]:
    for header in ("x-request-id", "request-id", "x-amzn-requestid"):
        value = response.headers.get(header)
        if value:
            return value
    return None


def _response_message(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict):
        for key in ("message", "error"):
            value = payload.get(key)
            if value:
                return f"HTTP {response.status_code}: {str(value)[:300]}"
    return f"HTTP {response.status_code}: endpoint access was not verified."
