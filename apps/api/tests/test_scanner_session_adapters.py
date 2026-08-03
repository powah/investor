import asyncio

import httpx
import pytest

from app.core.config import Settings
from app.scanner_sessions.adapters import AlpacaMarketMovementDiscovery
from app.scanner_sessions.domain import DiscoveryUnavailable


def test_alpaca_market_movement_discovery_normalizes_and_deduplicates_screeners():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith("/most-actives"):
            return httpx.Response(
                200,
                json={"most_actives": [{"symbol": "SINT"}, {"symbol": "AAPL"}]},
            )
        return httpx.Response(
            200,
            json={
                "gainers": [{"symbol": "sint"}, {"symbol": "ABVC"}],
                "losers": [{"symbol": "XYZ"}],
            },
        )

    settings = Settings(
        _env_file=None,
        alpaca_api_key_id="paper-key",
        alpaca_api_secret_key="paper-secret",
        alpaca_data_base_url="https://data.test",
    )
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    adapter = AlpacaMarketMovementDiscovery(settings, client=client)

    result = asyncio.run(adapter.discover())
    asyncio.run(client.aclose())

    assert result.records_count == 4
    assert result.details["symbols"] == ["AAPL", "ABVC", "SINT", "XYZ"]
    assert result.details["sources"] == {
        "most_actives": {
            "status": "completed",
            "endpoint": "/v1beta1/screener/stocks/most-actives",
        },
        "movers": {
            "status": "completed",
            "endpoint": "/v1beta1/screener/stocks/movers",
        },
    }
    assert {request.url.params["top"] for request in requests} == {"50"}
    assert {request.headers["APCA-API-KEY-ID"] for request in requests} == {"paper-key"}


def test_alpaca_market_movement_discovery_preserves_actionable_transport_diagnostics():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("connection timed out", request=request)

    settings = Settings(
        _env_file=None,
        alpaca_api_key_id="paper-key",
        alpaca_api_secret_key="paper-secret",
        alpaca_data_base_url="https://data.test",
    )
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    adapter = AlpacaMarketMovementDiscovery(settings, client=client)

    with pytest.raises(DiscoveryUnavailable) as exc_info:
        asyncio.run(adapter.discover())
    asyncio.run(client.aclose())

    assert exc_info.value.details == {
        "sources": {
            "most_actives": {
                "status": "failed",
                "endpoint": "/v1beta1/screener/stocks/most-actives",
                "message": "ConnectTimeout: connection timed out",
            },
            "movers": {
                "status": "failed",
                "endpoint": "/v1beta1/screener/stocks/movers",
                "message": "ConnectTimeout: connection timed out",
            },
        }
    }
