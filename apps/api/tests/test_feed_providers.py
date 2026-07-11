import asyncio
from datetime import date, datetime, timezone

import httpx
import pytest

import app.providers.sec_edgar as sec_edgar_module
from app.providers import (
    AlpacaMarketDataProvider,
    AlpacaNewsProvider,
    FilingProvider,
    MarketDataProvider,
    NewsProvider,
    ProviderPayloadError,
    SecEdgarProvider,
)


def _run(awaitable):
    return asyncio.run(awaitable)


def test_alpaca_market_snapshots_are_normalized_with_feed_provenance():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["request"] = request
        return httpx.Response(
            200,
            headers={"X-Request-ID": "market-request-123"},
            json={
                "snapshots": {
                    "AAPL": {
                        "latestTrade": {
                            "p": 210.15,
                            "s": 20,
                            "t": "2026-07-11T14:30:01.123456789Z",
                            "x": "Q",
                            "i": 42,
                            "c": ["@", "I"],
                        },
                        "latestQuote": {
                            "bp": 210.1,
                            "bs": 3,
                            "ap": 210.2,
                            "as": 4,
                            "t": "2026-07-11T14:30:01.2Z",
                            "bx": "P",
                            "ax": "Q",
                            "c": ["R"],
                        },
                        "minuteBar": {
                            "t": "2026-07-11T14:29:00Z",
                            "o": 209.9,
                            "h": 210.3,
                            "l": 209.8,
                            "c": 210.15,
                            "v": 1200,
                            "vw": 210.04,
                            "n": 90,
                        },
                        "dailyBar": {
                            "t": "2026-07-11T08:00:00Z",
                            "o": 205,
                            "h": 212,
                            "l": 204,
                            "c": 210.15,
                            "v": 500_000,
                            "vw": 208.5,
                            "n": 12_000,
                        },
                        "prevDailyBar": {
                            "t": "2026-07-10T08:00:00Z",
                            "o": 203,
                            "h": 206,
                            "l": 202,
                            "c": 205,
                            "v": 450_000,
                        },
                    }
                }
            },
        )

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = AlpacaMarketDataProvider(
                "market-key",
                "market-secret",
                feed="delayed_sip",
                client=client,
            )
            assert isinstance(provider, MarketDataProvider)
            return provider, await provider.get_snapshots([" aapl ", "MSFT", "AAPL"])

    provider, batch = _run(scenario())

    request = seen["request"]
    assert request.url.path == "/v2/stocks/snapshots"
    assert request.url.params["symbols"] == "AAPL,MSFT"
    assert request.url.params["feed"] == "delayed_sip"
    assert request.headers["APCA-API-KEY-ID"] == "market-key"
    assert request.headers["APCA-API-SECRET-KEY"] == "market-secret"
    assert provider.capabilities.real_time is False
    assert provider.capabilities.delay_seconds == 900
    assert provider.capabilities.is_consolidated is True
    assert provider.capabilities.history_start == date(2016, 1, 1)

    assert batch.provenance.request_id == "market-request-123"
    assert batch.provenance.source_feed == "delayed_sip"
    assert batch.provenance.delay_seconds == 900
    assert batch.provenance.is_consolidated is True
    assert batch.provenance.observed_at.tzinfo == timezone.utc
    assert len(batch.snapshots) == 1

    snapshot = batch.snapshots[0]
    assert snapshot.symbol == "AAPL"
    assert snapshot.provenance is batch.provenance
    assert snapshot.latest_trade.price == 210.15
    assert snapshot.latest_trade.conditions == ("@", "I")
    assert snapshot.latest_trade.timestamp == datetime(
        2026, 7, 11, 14, 30, 1, 123456, tzinfo=timezone.utc
    )
    assert snapshot.latest_quote.bid_price == 210.1
    assert snapshot.latest_quote.ask_exchange == "Q"
    assert snapshot.minute_bar.volume == 1200
    assert snapshot.minute_bar.vwap == 210.04
    assert snapshot.daily_bar.trade_count == 12_000
    assert snapshot.previous_daily_bar.close == 205


def test_alpaca_market_allows_per_request_feed_override():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["feed"] == "iex"
        return httpx.Response(200, json={"snapshots": {"AMD": {}}})

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = AlpacaMarketDataProvider("key", "secret", client=client)
            return await provider.get_snapshots(["AMD"], feed="IEX")

    batch = _run(scenario())

    assert batch.provenance.source_feed == "iex"
    assert batch.provenance.delay_seconds == 0
    assert batch.provenance.is_consolidated is False
    assert batch.snapshots[0].latest_trade is None
    assert batch.snapshots[0].daily_bar is None


@pytest.mark.parametrize("feed", ["", "free", "nbbo"])
def test_alpaca_market_rejects_unknown_feed(feed):
    with pytest.raises(ValueError, match="Unsupported Alpaca stock feed"):
        AlpacaMarketDataProvider("key", "secret", feed=feed)


def test_alpaca_market_rejects_empty_symbol_list_before_request():
    provider = AlpacaMarketDataProvider("key", "secret")
    try:
        with pytest.raises(ValueError, match="At least one"):
            _run(provider.get_snapshots([" ", ""]))
    finally:
        _run(provider.aclose())


def test_alpaca_news_is_paginated_normalized_and_preserves_request_id():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["request"] = request
        return httpx.Response(
            200,
            headers={"x-request-id": "news-request-456"},
            json={
                "news": [
                    {
                        "id": 987,
                        "headline": "Issuer announces material agreement",
                        "summary": "A concise summary.",
                        "author": "Newsdesk",
                        "created_at": "2026-07-11T13:00:00.000000001Z",
                        "updated_at": "2026-07-11T13:01:02Z",
                        "url": "https://example.test/article",
                        "content": "<p>Full story</p>",
                        "symbols": ["aapl", "MSFT"],
                        "source": "benzinga",
                    }
                ],
                "next_page_token": "next-page",
            },
        )

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = AlpacaNewsProvider("news-key", "news-secret", client=client)
            assert isinstance(provider, NewsProvider)
            page = await provider.get_news(
                symbols=[" aapl ", "AAPL", "msft"],
                start=datetime(2026, 7, 11, 12, tzinfo=timezone.utc),
                end=datetime(2026, 7, 11, 14, tzinfo=timezone.utc),
                limit=25,
                page_token="page-1",
                include_content=True,
            )
            return provider, page

    provider, page = _run(scenario())

    request = seen["request"]
    assert request.url.path == "/v1beta1/news"
    assert request.url.params["symbols"] == "AAPL,MSFT"
    assert request.url.params["start"] == "2026-07-11T12:00:00Z"
    assert request.url.params["end"] == "2026-07-11T14:00:00Z"
    assert request.url.params["limit"] == "25"
    assert request.url.params["page_token"] == "page-1"
    assert request.url.params["include_content"] == "true"
    assert request.headers["APCA-API-KEY-ID"] == "news-key"
    assert request.headers["APCA-API-SECRET-KEY"] == "news-secret"
    assert provider.capabilities.real_time is False
    assert provider.capabilities.delay_seconds == 900
    assert provider.capabilities.max_page_size == 50

    assert page.next_page_token == "next-page"
    assert page.provenance.request_id == "news-request-456"
    article = page.articles[0]
    assert article.external_id == "987"
    assert article.headline == "Issuer announces material agreement"
    assert article.symbols == ("AAPL", "MSFT")
    assert article.source == "benzinga"
    assert article.content == "<p>Full story</p>"
    assert article.created_at == datetime(
        2026, 7, 11, 13, 0, 0, 0, tzinfo=timezone.utc
    )
    assert article.provenance is page.provenance


def test_alpaca_news_real_time_capability_is_explicit():
    provider = AlpacaNewsProvider("key", "secret", real_time_access=True)
    try:
        assert provider.capabilities.real_time is True
        assert provider.capabilities.delay_seconds == 0
    finally:
        _run(provider.aclose())


@pytest.mark.parametrize("limit", [0, 51])
def test_alpaca_news_validates_page_size(limit):
    provider = AlpacaNewsProvider("key", "secret")
    try:
        with pytest.raises(ValueError, match="between 1 and 50"):
            _run(provider.get_news(limit=limit))
    finally:
        _run(provider.aclose())


def test_alpaca_news_rejects_malformed_success_payload():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"news": [{"id": 1}]})

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = AlpacaNewsProvider("key", "secret", client=client)
            return await provider.get_news()

    with pytest.raises(ProviderPayloadError, match="require id, headline"):
        _run(scenario())


def test_sec_ticker_map_declares_user_agent_and_normalizes_rows():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["request"] = request
        return httpx.Response(
            200,
            headers={"X-Request-ID": "sec-map-1"},
            json={
                "fields": ["cik", "name", "ticker", "exchange"],
                "data": [
                    [320193, "Apple Inc.", "aapl", "Nasdaq"],
                    [789019, "Microsoft Corp", "MSFT", "Nasdaq"],
                    [None, "Invalid", "BAD", "NYSE"],
                ],
            },
        )

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = SecEdgarProvider(
                "Investor Tool admin@example.test",
                client=client,
            )
            assert isinstance(provider, FilingProvider)
            return provider, await provider.get_ticker_map()

    provider, ticker_map = _run(scenario())

    request = seen["request"]
    assert request.url == httpx.URL(
        "https://www.sec.gov/files/company_tickers_exchange.json"
    )
    assert request.headers["User-Agent"] == "Investor Tool admin@example.test"
    assert request.headers["Accept"] == "application/json"
    assert "gzip" in request.headers["Accept-Encoding"]
    assert provider.capabilities.fair_access_requests_per_second == 10
    assert provider.capabilities.typical_delay_seconds == 1

    assert ticker_map.provenance.request_id == "sec-map-1"
    assert ticker_map.provenance.source_feed == "company_tickers_exchange"
    assert [(entry.cik, entry.ticker, entry.exchange) for entry in ticker_map.entries] == [
        ("0000320193", "AAPL", "Nasdaq"),
        ("0000789019", "MSFT", "Nasdaq"),
    ]
    assert ticker_map.entries[0].provenance is ticker_map.provenance


def test_sec_submissions_normalize_recent_columnar_filings_and_urls():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["request"] = request
        return httpx.Response(
            200,
            headers={"request-id": "sec-submissions-2"},
            json={
                "cik": "320193",
                "name": "Apple Inc.",
                "tickers": ["aapl", "AAPL.MX"],
                "exchanges": ["Nasdaq", "BMV"],
                "filings": {
                    "recent": {
                        "accessionNumber": [
                            "0000320193-26-000077",
                            "0000320193-26-000076",
                        ],
                        "filingDate": ["2026-07-10", "2026-07-09"],
                        "reportDate": ["2026-07-10", ""],
                        "acceptanceDateTime": [
                            "2026-07-10T123456.123456789Z"
                        ],
                        "form": ["8-k", "4"],
                        "items": ["2.02, 9.01", ""],
                        "isXBRL": [1, 0],
                        "isInlineXBRL": ["true", "false"],
                        "primaryDocument": ["aapl-20260710.htm", "xslF345X05/doc.xml"],
                        "primaryDocDescription": ["CURRENT REPORT", "FORM 4"],
                    },
                    "files": [
                        {
                            "name": "CIK0000320193-submissions-001.json",
                            "filingCount": 500,
                        }
                    ],
                },
            },
        )

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = SecEdgarProvider(
                "Investor Tool admin@example.test",
                client=client,
            )
            return await provider.get_submissions("CIK320193")

    submissions = _run(scenario())

    request = seen["request"]
    assert request.url == httpx.URL(
        "https://data.sec.gov/submissions/CIK0000320193.json"
    )
    assert request.headers["User-Agent"] == "Investor Tool admin@example.test"
    assert submissions.cik == "0000320193"
    assert submissions.company_name == "Apple Inc."
    assert submissions.tickers == ("AAPL", "AAPL.MX")
    assert submissions.exchanges == ("Nasdaq", "BMV")
    assert submissions.older_history_files == (
        "CIK0000320193-submissions-001.json",
    )
    assert submissions.provenance.request_id == "sec-submissions-2"

    current_report, ownership = submissions.filings
    assert current_report.accession_number == "0000320193-26-000077"
    assert current_report.form == "8-K"
    assert current_report.filing_date == date(2026, 7, 10)
    assert current_report.report_date == date(2026, 7, 10)
    assert current_report.accepted_at == datetime(
        2026, 7, 10, 12, 34, 56, 123456, tzinfo=timezone.utc
    )
    assert current_report.items == ("2.02", "9.01")
    assert current_report.is_xbrl is True
    assert current_report.is_inline_xbrl is True
    assert current_report.document_url == (
        "https://www.sec.gov/Archives/edgar/data/320193/"
        "000032019326000077/aapl-20260710.htm"
    )
    assert current_report.index_url == (
        "https://www.sec.gov/Archives/edgar/data/320193/"
        "000032019326000077/0000320193-26-000077-index.html"
    )
    assert current_report.provenance is submissions.provenance

    assert ownership.form == "4"
    assert ownership.report_date is None
    assert ownership.accepted_at is None
    assert ownership.is_xbrl is False
    assert ownership.document_url.endswith("/xslF345X05/doc.xml")


@pytest.mark.parametrize("cik", ["", "ABC", "0", "12345678901"])
def test_sec_submissions_reject_invalid_cik_before_request(cik):
    provider = SecEdgarProvider("Investor Tool admin@example.test")
    try:
        with pytest.raises(ValueError, match="CIK must be"):
            _run(provider.get_submissions(cik))
    finally:
        _run(provider.aclose())


@pytest.mark.parametrize(
    "user_agent",
    [
        "  ",
        "bot",
        "admin@",
        "bot example.com",
        "admin@example.test",
        "Investor Tool admin@example.test\nInjected: value",
    ],
)
def test_sec_requires_identified_contact_email(user_agent):
    with pytest.raises(ValueError, match="contact email"):
        SecEdgarProvider(user_agent)


def test_sec_rate_limiter_is_shared_per_loop_and_awaited_before_every_request(monkeypatch):
    events = []

    class RecordingLimiter:
        async def wait(self):
            events.append("wait")

    limiter = RecordingLimiter()
    monkeypatch.setattr(sec_edgar_module, "_shared_sec_rate_limiter", lambda: limiter)

    def handler(request: httpx.Request) -> httpx.Response:
        events.append("request")
        if request.url.host == "data.sec.gov":
            return httpx.Response(
                200,
                json={
                    "name": "Apple Inc.",
                    "tickers": ["AAPL"],
                    "exchanges": ["Nasdaq"],
                    "filings": {"recent": {"accessionNumber": []}},
                },
            )
        return httpx.Response(
            200,
            json={
                "fields": ["cik", "name", "ticker", "exchange"],
                "data": [[320193, "Apple Inc.", "AAPL", "Nasdaq"]],
            },
        )

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            first = SecEdgarProvider("Investor Tool admin@example.test", client=client)
            second = SecEdgarProvider("Investor Tool admin@example.test", client=client)
            await first.get_ticker_map()
            await second.get_submissions("320193")

    _run(scenario())

    assert events == ["wait", "request", "wait", "request"]


def test_sec_default_rate_limiter_is_shared_across_provider_instances():
    async def scenario():
        first = SecEdgarProvider("Investor Tool admin@example.test")
        second = SecEdgarProvider("Investor Tool admin@example.test")
        try:
            return (
                sec_edgar_module._shared_sec_rate_limiter()
                is sec_edgar_module._shared_sec_rate_limiter()
            )
        finally:
            await first.aclose()
            await second.aclose()

    assert _run(scenario()) is True


def test_provider_http_errors_retain_httpx_status_and_request():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429,
            headers={"X-Request-ID": "rate-limited-request"},
            json={"message": "rate limit exceeded"},
        )

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = AlpacaMarketDataProvider("key", "secret", client=client)
            return await provider.get_snapshots(["AAPL"])

    with pytest.raises(httpx.HTTPStatusError) as exc_info:
        _run(scenario())

    assert exc_info.value.response.status_code == 429
    assert exc_info.value.response.headers["X-Request-ID"] == "rate-limited-request"
    assert exc_info.value.request.url.path == "/v2/stocks/snapshots"
