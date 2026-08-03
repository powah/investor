from __future__ import annotations

import asyncio
from typing import Any

import httpx

from app.core.config import Settings
from app.scanner_sessions.domain import DiscoveryResult, DiscoveryUnavailable


class AlpacaMarketMovementDiscovery:
    source = "alpaca_market_movement"

    def __init__(self, settings: Settings, *, client: httpx.AsyncClient | None = None):
        self._settings = settings
        self._client = client

    async def discover(self) -> DiscoveryResult:
        if not self._settings.alpaca_configured:
            raise DiscoveryUnavailable(
                code="alpaca_not_configured",
                message="Alpaca paper credentials are not configured for Market-Movement Discovery.",
            )

        headers = {
            "APCA-API-KEY-ID": self._settings.alpaca_api_key_id,
            "APCA-API-SECRET-KEY": self._settings.alpaca_api_secret_key,
            "Accept": "application/json",
        }
        endpoints = {
            "most_actives": "/v1beta1/screener/stocks/most-actives",
            "movers": "/v1beta1/screener/stocks/movers",
        }
        if self._client is None:
            async with httpx.AsyncClient(timeout=20.0) as client:
                responses = await self._request_screeners(client, endpoints, headers)
        else:
            responses = await self._request_screeners(self._client, endpoints, headers)

        symbols: set[str] = set()
        source_results: dict[str, dict[str, Any]] = {}
        available_sources: list[str] = []
        for (name, path), response in zip(endpoints.items(), responses, strict=True):
            if isinstance(response, BaseException):
                error_detail = str(response).strip() or "request failed"
                source_results[name] = {
                    "status": "failed",
                    "endpoint": path,
                    "message": f"{type(response).__name__}: {error_detail}",
                }
                continue
            if not 200 <= response.status_code < 300:
                source_results[name] = {
                    "status": "unavailable" if response.status_code in {401, 403, 404, 422} else "failed",
                    "endpoint": path,
                    "http_status": response.status_code,
                    "message": self._response_message(response),
                }
                continue

            try:
                payload = response.json()
                symbols.update(self._symbols(payload))
            except (TypeError, ValueError) as exc:
                source_results[name] = {
                    "status": "failed",
                    "endpoint": path,
                    "message": f"Invalid provider payload: {exc}",
                }
                continue
            available_sources.append(name)
            source_results[name] = {"status": "completed", "endpoint": path}

        if not available_sources:
            raise DiscoveryUnavailable(
                code="required_discovery_unavailable",
                message="Alpaca mover and most-active screeners are unavailable; required Market-Movement Discovery could not run.",
                details={"sources": source_results},
            )

        return DiscoveryResult(
            records_count=len(symbols),
            message="Alpaca Market-Movement Discovery completed.",
            details={
                "sources": source_results,
                "symbols": sorted(symbols),
            },
        )

    async def _request_screeners(
        self,
        client: httpx.AsyncClient,
        endpoints: dict[str, str],
        headers: dict[str, str],
    ) -> list[httpx.Response | BaseException]:
        return await asyncio.gather(
            *(
                client.get(
                    f"{self._settings.alpaca_data_base_url.rstrip('/')}{path}",
                    params={"top": 50},
                    headers=headers,
                )
                for path in endpoints.values()
            ),
            return_exceptions=True,
        )

    @staticmethod
    def _symbols(payload: Any) -> set[str]:
        if not isinstance(payload, dict):
            raise ValueError("response must be an object")
        rows: list[Any] = []
        for key in ("most_actives", "gainers", "losers"):
            value = payload.get(key, [])
            if not isinstance(value, list):
                raise ValueError(f"{key} must be an array")
            rows.extend(value)
        return {
            str(row["symbol"]).strip().upper()
            for row in rows
            if isinstance(row, dict) and str(row.get("symbol") or "").strip()
        }

    @staticmethod
    def _response_message(response: httpx.Response) -> str:
        try:
            payload = response.json()
        except ValueError:
            return f"HTTP {response.status_code}: endpoint access was not verified."
        if isinstance(payload, dict):
            message = payload.get("message") or payload.get("error")
            if message:
                return f"HTTP {response.status_code}: {str(message)[:300]}"
        return f"HTTP {response.status_code}: endpoint access was not verified."
