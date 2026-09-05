import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.scanner_sessions import Listing, Security
from app.scanner_sessions.delayed_bars import AlpacaDelayedBarDiscovery, listing_universe
from app.scanner_sessions.domain import DiscoveryUnavailable
from app.schemas.scanner_sessions import NormalizedDiscoveryHit


NOW = datetime(2026, 7, 6, 13, 45, tzinfo=timezone.utc)
PAYLOAD = json.loads((Path(__file__).parent / "fixtures/alpaca/delayed_bars.json").read_text())


def listing(ticker="SINT", **changes):
    return NormalizedDiscoveryHit(
        source="registry", source_reference=f"listing:{ticker}", ticker=ticker,
        discovery_reason="Universe", security_identifier_source="registry",
        security_identifier=ticker, exchange="nasdaq", listing_status="active",
        instrument_type="common_stock", effective_from="2020-01-01", **changes,
    )


def scan(handler, universe=None, **settings):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            adapter = AlpacaDelayedBarDiscovery(
                Settings(_env_file=None, alpaca_api_key_id="key", alpaca_api_secret_key="secret", **settings),
                universe if universe is not None else [listing(), listing("QUIET"), listing("MISSING")],
                client=client, clock=lambda: NOW,
            )
            return await adapter.discover()
    return asyncio.run(run())


def test_real_shaped_bars_normalize_reasons_and_source_contract():
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json=PAYLOAD)
    result = scan(handler)
    result.validate()
    assert len(result.hits) == 2
    assert all(hit.ticker == "SINT" for hit in result.hits)
    assert result.hits[0].discovery_reason.startswith("Market movement: +10.00%")
    assert result.hits[1].discovery_reason.startswith("Activity: 150,000 shares")
    assert result.hits[0].observed_at == NOW
    assert result.hits[0].source_reference.endswith("2026-07-06T13:29:00+00:00")
    assert result.details["data_tier"] == "delayed_consolidated"
    assert result.details["coverage"] == "consolidated_us_equities"
    assert result.details["expected_delay_seconds"] == 900
    assert result.details["provider_event_at"] == "2026-07-06T13:29:00+00:00"
    assert result.details["symbols_without_bars"] == ["MISSING"]
    assert result.details["symbols_with_bars"] == 2
    assert len(requests) == 1
    assert requests[0].url.path == "/v2/stocks/bars"
    assert requests[0].url.params["feed"] == "sip"
    assert requests[0].url.params["end"] == "2026-07-06T13:30:00+00:00"
    assert requests[0].url.params["start"] == "2026-07-06T12:30:00+00:00"
    assert requests[0].headers["APCA-API-KEY-ID"] == "key"
    assert "vw" not in result.hits[0].model_dump()


def test_batches_and_pagination_cover_every_symbol_without_double_counting_bars():
    requests = []
    def handler(request):
        requests.append(request)
        symbols = request.url.params["symbols"].split(",")
        assert len(symbols) <= 100
        page = request.url.params.get("page_token")
        return httpx.Response(200, json={
            "bars": {symbol: PAYLOAD["bars"]["SINT"] for symbol in symbols},
            "next_page_token": None if page else "next",
        })
    result = scan(handler, [listing(f"S{i:03}") for i in range(201)])
    assert len(requests) == 6
    assert result.details["requested_symbols"] == result.details["symbols_with_bars"] == 201
    assert result.records_count == 402
    assert result.hits[1].discovery_reason.startswith("Activity: 150,000")


@pytest.mark.parametrize("payload", [
    {}, {"bars": []}, {"bars": {"UNREQUESTED": []}},
    {"bars": {"SINT": [{}]}},
    {"bars": {"SINT": [{"t": "2026-07-06T13:29:00Z", "o": 0, "c": 2, "v": 100}]}},
    {"bars": {"SINT": [{"t": "2026-07-06T13:44:00Z", "o": 2, "c": 2, "v": 100}]}},
    {"bars": {}, "next_page_token": "repeated"},
])
def test_invalid_or_truncated_payloads_cannot_report_success(payload):
    with pytest.raises(ValueError):
        scan(lambda request: httpx.Response(200, json=payload))


@pytest.mark.parametrize("status", [401, 403, 404, 422, 429, 500])
def test_unavailable_or_failed_required_discovery(status):
    with pytest.raises(DiscoveryUnavailable if status in {401, 403, 404, 422} else httpx.HTTPStatusError):
        scan(lambda request: httpx.Response(status, json={"message": "access denied"}))


def test_failure_on_later_batch_does_not_return_partial_success():
    calls = 0
    def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"bars": {}}) if calls == 1 else httpx.Response(500)
    with pytest.raises(httpx.HTTPStatusError):
        scan(handler, [listing(f"S{i}") for i in range(101)])


def test_zero_hits_is_success_but_empty_universe_or_iex_is_unavailable():
    handler = lambda request: httpx.Response(200, json={"bars": {}})
    assert scan(handler).records_count == 0
    with pytest.raises(DiscoveryUnavailable, match="No active eligible Listings"):
        scan(handler, [])
    with pytest.raises(DiscoveryUnavailable, match="IEX is not consolidated"):
        scan(handler, alpaca_scanner_feed="iex")


def test_registry_universe_filters_effective_dates_and_instrument_identity():
    engine = create_engine("sqlite://")
    Security.__table__.create(engine)
    Listing.__table__.create(engine)
    with Session(engine) as db:
        security = Security(identifier_source="registry", identifier="issuer")
        db.add(security)
        db.flush()
        from datetime import date
        for index, changes in enumerate([
            {}, {"instrument_type": "fund"}, {"status": "inactive"},
            {"exchange": "otc"}, {"effective_from": date(2027, 1, 1)},
            {"effective_to": date(2025, 1, 1)},
            {"instrument_type": "american_depositary_share", "foreign_issuer": None},
            {"instrument_type": "american_depositary_share", "foreign_issuer": True, "depositary_to_underlying_ratio": 2},
        ]):
            fields = dict(security_id=security.id, ticker=f"T{index}", exchange="nasdaq", status="active", instrument_type="common_stock", effective_from=date(2020, 1, 1))
            db.add(Listing(**(fields | changes)))
        db.commit()
        universe = listing_universe(db, NOW)
    assert [item.ticker for item in universe] == ["T0", "T7"]
    assert universe[1].depositary_to_underlying_ratio == 2
    engine.dispose()
