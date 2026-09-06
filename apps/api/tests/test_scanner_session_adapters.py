import asyncio
from datetime import datetime, timezone

import httpx
import pytest

from app.core.config import Settings
from app.scanner_sessions.adapters import AlpacaScreenerDiscovery
from app.scanner_sessions.domain import DiscoveryUnavailable
from app.schemas.scanner_sessions import NormalizedDiscoveryHit

NOW = datetime(2026, 7, 6, 14, tzinfo=timezone.utc)
MOVERS = {
    "last_updated": "2026-07-06T13:59:00Z",
    "gainers": [{"symbol": "SINT", "price": 2.2, "change": 0.2, "percent_change": 10}],
    "losers": [{"symbol": "XYZ", "price": 3, "change": -1, "percent_change": -25}],
}
ACTIVES = {
    "last_updated": "2026-07-06T13:59:00Z",
    "most_actives": [{"symbol": "SINT", "volume": 150000, "trade_count": 1234}],
}


def scan(handler, kind="movers", universe=()):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await AlpacaScreenerDiscovery(
                Settings(_env_file=None, alpaca_api_key_id="key", alpaca_api_secret_key="secret"),
                kind, universe, client=client, clock=lambda: NOW,
            ).discover()
    return asyncio.run(run())


@pytest.mark.parametrize("kind,payload,count", [("movers", MOVERS, 2), ("most_actives", ACTIVES, 1)])
def test_real_shaped_screeners_retain_occurrences_and_provenance(kind, payload, count):
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json=payload, headers={"x-request-id": "request-123"})
    result = scan(handler, kind)
    result.validate()
    assert result.records_count == count
    hit = result.hits[0]
    assert hit.source == f"alpaca_{kind}"
    assert hit.ticker == "SINT"
    assert hit.provenance["request_id"] == "request-123"
    assert hit.provenance["feed"] == "sip"
    assert hit.provenance["data_tier"] == "screener_consolidated"
    assert hit.provenance["expected_delay_seconds"] is None
    assert hit.provenance["provider_event_at"] == "2026-07-06T13:59:00+00:00"
    assert hit.observed_at == NOW
    assert hit.security_identifier is None
    assert hit.discovery_reason.startswith("Mover gainers: +10.00%" if kind == "movers" else "Most active: 150,000 shares")
    assert requests[0].url.params["top"] == "50"
    assert requests[0].headers["APCA-API-KEY-ID"] == "key"


def test_registry_identity_is_only_attached_when_ticker_is_unambiguous():
    listing = NormalizedDiscoveryHit(
        source="registry", source_reference="listing:1", ticker="SINT", discovery_reason="registry",
        security_identifier_source="registry", security_identifier="stable-1",
        exchange="nasdaq", instrument_type="common_stock", listing_status="active", effective_from="2020-01-01",
    )
    handler = lambda request: httpx.Response(200, json=ACTIVES)
    assert scan(handler, "most_actives", [listing]).hits[0].security_identifier == "stable-1"
    assert scan(handler, "most_actives", [listing, listing.model_copy(update={"security_identifier": "stable-2"})]).hits[0].security_identifier is None


@pytest.mark.parametrize("status", [401, 403, 404, 422, 429, 500])
def test_screener_errors_preserve_http_provenance(status):
    with pytest.raises(DiscoveryUnavailable) as exc:
        scan(lambda request: httpx.Response(status, json={"message": "access denied"}, headers={"x-request-id": "denied"}))
    assert exc.value.details["http_status"] == status
    assert exc.value.details["request_id"] == "denied"


@pytest.mark.parametrize("payload", [
    {}, [], {**MOVERS, "gainers": {}}, {**MOVERS, "gainers": [{}]},
    {**MOVERS, "last_updated": "2026-07-06T14:01:00Z"},
    {**MOVERS, "last_updated": "2026-07-06T13:59:00"},
    {**MOVERS, "gainers": [{"symbol": "SINT", "percent_change": True}]},
])
def test_invalid_payload_is_not_success(payload):
    with pytest.raises(DiscoveryUnavailable, match="Invalid"):
        scan(lambda request: httpx.Response(200, json=payload))


def test_transport_failure_is_actionable():
    def handler(request):
        raise httpx.ConnectTimeout("connection timed out", request=request)
    with pytest.raises(httpx.ConnectTimeout, match="connection timed out"):
        scan(handler)


def test_valid_empty_screener_is_success_and_duplicates_are_not_removed():
    assert scan(lambda request: httpx.Response(200, json={**MOVERS, "gainers": [], "losers": []})).records_count == 0
    result = scan(lambda request: httpx.Response(200, json={**MOVERS, "gainers": MOVERS["gainers"] * 2}))
    assert result.records_count == 3
    assert result.hits[0].source_reference != result.hits[1].source_reference
