import asyncio

import httpx
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.core.database import Base
from app.models.integrations import ProviderCapabilityCheck
from app.providers.alpaca_capabilities import AlpacaCapabilityProbe
from app.services.capabilities import (
    capability_configuration_fingerprint, latest_capability_checks, probe_alpaca_capabilities,
)


def _run(coro):
    return asyncio.run(coro)


def _handler(seen):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        request_id = f"request-{len(seen)}"
        if request.url.path == "/v2/stocks/snapshots" and request.url.params["feed"] == "iex":
            return httpx.Response(
                403,
                headers={"x-request-id": request_id},
                json={"message": "subscription does not permit querying recent SIP data"},
            )
        if request.url.path.startswith("/v1beta1/screener/"):
            return httpx.Response(
                403,
                headers={"x-request-id": request_id},
                json={"message": "insufficient subscription"},
            )
        return httpx.Response(200, headers={"x-request-id": request_id}, json={})

    return handler


def test_probe_tests_only_read_endpoints_and_reports_each_capability():
    seen = []

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(_handler(seen))) as client:
            probe = AlpacaCapabilityProbe(
                "paper-key",
                "paper-secret",
                data_base_url="https://data.alpaca.test",
                trading_base_url="https://paper-api.alpaca.test",
                client=client,
            )
            return await probe.probe(scanner_feed="delayed_sip", execution_feed="iex")

    results = _run(scenario())
    by_capability = {result.capability: result for result in results}

    assert all(request.method == "GET" for request in seen)
    assert by_capability["market_data:delayed_sip"].status == "available"
    assert by_capability["market_data:iex"].status == "unavailable"
    assert by_capability["news"].status == "available"
    assert by_capability["screener:most_actives"].status == "unavailable"
    assert by_capability["screener:movers"].status == "unavailable"
    assert by_capability["paper_account"].status == "available"
    assert by_capability["market_data:iex"].http_status == 403
    assert by_capability["market_data:iex"].request_id is not None


def test_probe_results_are_persisted_and_latest_results_are_queryable():
    engine = create_engine("sqlite+pysqlite:///:memory:", poolclass=StaticPool)
    testing_session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(engine)
    settings = Settings(
        _env_file=None,
        database_url="sqlite+pysqlite:///:memory:",
        alpaca_api_key_id="paper-key",
        alpaca_api_secret_key="paper-secret",
        alpaca_trading_base_url="https://paper-api.alpaca.markets",
        alpaca_data_base_url="https://data.alpaca.test",
        alpaca_scanner_feed="delayed_sip",
        alpaca_execution_feed="iex",
    )

    async def scenario(db):
        async with httpx.AsyncClient(transport=httpx.MockTransport(_handler([]))) as client:
            probe = AlpacaCapabilityProbe(
                "paper-key",
                "paper-secret",
                data_base_url=settings.alpaca_data_base_url,
                trading_base_url=settings.alpaca_trading_base_url,
                client=client,
            )
            return await probe_alpaca_capabilities(db, settings, probe=probe)

    with testing_session() as db:
        checks = _run(scenario(db))
        assert len(checks) == 6
        assert all(check.details["configuration_fingerprint"] == capability_configuration_fingerprint(settings) for check in checks)
        assert "paper-secret" not in str([check.details for check in checks])
        assert db.query(ProviderCapabilityCheck).count() == 6
        latest = latest_capability_checks(db)
        assert {check.capability for check in latest} == {
            "market_data:delayed_sip",
            "market_data:iex",
            "news",
            "screener:most_actives",
            "screener:movers",
            "paper_account",
        }
