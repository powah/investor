"""Alpaca REST adapters for normalized market snapshots and news."""

from datetime import date, datetime, timezone
from typing import Any, Dict, Mapping, Optional, Sequence, Tuple

import httpx

from app.providers._normalization import (
    optional_float,
    optional_int,
    parse_datetime,
    string_tuple,
    utc_now,
)
from app.providers.contracts import (
    MarketBar,
    MarketDataCapabilities,
    MarketQuote,
    MarketSnapshot,
    MarketSnapshotBatch,
    MarketTrade,
    NewsArticle,
    NewsPage,
    NewsProviderCapabilities,
    ProviderPayloadError,
    Provenance,
)


ALPACA_DATA_BASE_URL = "https://data.alpaca.markets"
_ALLOWED_STOCK_FEEDS = {
    "boats",
    "delayed_sip",
    "iex",
    "otc",
    "overnight",
    "sip",
}
_FEED_PROPERTIES = {
    "delayed_sip": (False, 900, True, "all_us_exchanges_delayed"),
    "iex": (True, 0, False, "iex_single_venue"),
    "sip": (True, 0, True, "all_us_exchanges"),
    "boats": (True, 0, False, "boats_overnight_ats"),
    "overnight": (True, 0, False, "derived_overnight"),
    "otc": (True, 0, False, "otc"),
}


def _clean_required_secret(value: str, name: str) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise ValueError(f"{name} must not be blank.")
    return cleaned


def _normalize_symbols(symbols: Sequence[str]) -> Tuple[str, ...]:
    normalized = []
    seen = set()
    for raw_symbol in symbols:
        symbol = str(raw_symbol).strip().upper()
        if not symbol or symbol in seen:
            continue
        normalized.append(symbol)
        seen.add(symbol)
    if not normalized:
        raise ValueError("At least one non-blank symbol is required.")
    return tuple(normalized)


def _request_id(response: httpx.Response) -> Optional[str]:
    for header in ("x-request-id", "request-id", "x-amzn-requestid"):
        value = response.headers.get(header)
        if value:
            return value
    return None


def _format_datetime(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


class _AlpacaRestAdapter:
    def __init__(
        self,
        api_key: str,
        api_secret: str,
        *,
        base_url: str,
        client: Optional[httpx.AsyncClient],
    ) -> None:
        self._api_key = _clean_required_secret(api_key, "api_key")
        self._api_secret = _clean_required_secret(api_secret, "api_secret")
        self._base_url = base_url.rstrip("/")
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=20.0)

    @property
    def _headers(self) -> Dict[str, str]:
        return {
            "APCA-API-KEY-ID": self._api_key,
            "APCA-API-SECRET-KEY": self._api_secret,
            "Accept": "application/json",
        }

    async def _get(self, path: str, params: Mapping[str, Any]) -> httpx.Response:
        response = await self._client.get(
            f"{self._base_url}{path}",
            params=params,
            headers=self._headers,
        )
        response.raise_for_status()
        return response

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_value, traceback) -> None:
        await self.aclose()


class AlpacaMarketDataProvider(_AlpacaRestAdapter):
    """Fetch Alpaca's multi-symbol stock snapshots through a stable contract."""

    def __init__(
        self,
        api_key: str,
        api_secret: str,
        *,
        feed: str = "delayed_sip",
        base_url: str = ALPACA_DATA_BASE_URL,
        client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        normalized_feed = self._validate_feed(feed)
        super().__init__(
            api_key,
            api_secret,
            base_url=base_url,
            client=client,
        )
        self._feed = normalized_feed

    @staticmethod
    def _validate_feed(feed: str) -> str:
        normalized = feed.strip().lower()
        if normalized not in _ALLOWED_STOCK_FEEDS:
            choices = ", ".join(sorted(_ALLOWED_STOCK_FEEDS))
            raise ValueError(f"Unsupported Alpaca stock feed {feed!r}; choose one of: {choices}.")
        return normalized

    def _capabilities_for(self, feed: str) -> MarketDataCapabilities:
        real_time, delay_seconds, consolidated, coverage = _FEED_PROPERTIES[feed]
        return MarketDataCapabilities(
            provider="alpaca",
            feed=feed,
            real_time=real_time,
            delay_seconds=delay_seconds,
            is_consolidated=consolidated,
            coverage=coverage,
            history_start=date(2016, 1, 1),
            supports_snapshots=True,
            supports_streaming=False,
            max_stream_symbols=None,
        )

    @property
    def capabilities(self) -> MarketDataCapabilities:
        return self._capabilities_for(self._feed)

    async def get_snapshots(
        self,
        symbols: Sequence[str],
        *,
        feed: Optional[str] = None,
    ) -> MarketSnapshotBatch:
        requested_symbols = _normalize_symbols(symbols)
        requested_feed = self._validate_feed(feed) if feed is not None else self._feed
        capabilities = self._capabilities_for(requested_feed)
        response = await self._get(
            "/v2/stocks/snapshots",
            {"symbols": ",".join(requested_symbols), "feed": requested_feed},
        )
        payload = response.json()
        raw_snapshots = payload.get("snapshots", payload) if isinstance(payload, dict) else None
        if not isinstance(raw_snapshots, dict):
            raise ProviderPayloadError("Alpaca snapshots response must contain an object.")

        observed_at = utc_now()
        provenance = Provenance(
            provider="alpaca",
            observed_at=observed_at,
            source_feed=requested_feed,
            request_id=_request_id(response),
            delay_seconds=capabilities.delay_seconds,
            is_consolidated=capabilities.is_consolidated,
        )
        normalized_by_symbol = {
            str(symbol).upper(): snapshot
            for symbol, snapshot in raw_snapshots.items()
            if isinstance(snapshot, dict)
        }
        snapshots = tuple(
            self._normalize_snapshot(symbol, normalized_by_symbol[symbol], provenance)
            for symbol in requested_symbols
            if symbol in normalized_by_symbol
        )
        return MarketSnapshotBatch(snapshots=snapshots, provenance=provenance)

    @staticmethod
    def _normalize_snapshot(
        symbol: str,
        payload: Mapping[str, Any],
        provenance: Provenance,
    ) -> MarketSnapshot:
        return MarketSnapshot(
            symbol=symbol,
            provenance=provenance,
            latest_trade=_normalize_trade(payload.get("latestTrade")),
            latest_quote=_normalize_quote(payload.get("latestQuote")),
            minute_bar=_normalize_bar(payload.get("minuteBar")),
            daily_bar=_normalize_bar(payload.get("dailyBar")),
            previous_daily_bar=_normalize_bar(payload.get("prevDailyBar")),
        )


class AlpacaNewsProvider(_AlpacaRestAdapter):
    """Fetch Alpaca/Benzinga news through a normalized, paginated contract."""

    def __init__(
        self,
        api_key: str,
        api_secret: str,
        *,
        real_time_access: bool = False,
        base_url: str = ALPACA_DATA_BASE_URL,
        client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        super().__init__(
            api_key,
            api_secret,
            base_url=base_url,
            client=client,
        )
        self._real_time_access = real_time_access

    @property
    def capabilities(self) -> NewsProviderCapabilities:
        return NewsProviderCapabilities(
            provider="alpaca",
            real_time=self._real_time_access,
            delay_seconds=0 if self._real_time_access else 900,
            history_start=date(2015, 1, 1),
            max_page_size=50,
            supports_streaming=False,
        )

    async def get_news(
        self,
        *,
        symbols: Sequence[str] = (),
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        limit: int = 50,
        page_token: Optional[str] = None,
        include_content: bool = False,
    ) -> NewsPage:
        if not 1 <= limit <= self.capabilities.max_page_size:
            raise ValueError("Alpaca news limit must be between 1 and 50.")
        normalized_start = parse_datetime(start)
        normalized_end = parse_datetime(end)
        if (
            normalized_start is not None
            and normalized_end is not None
            and normalized_start > normalized_end
        ):
            raise ValueError("News start must not be after end.")

        params: Dict[str, Any] = {
            "limit": limit,
            "include_content": str(include_content).lower(),
        }
        normalized_symbols = tuple(
            dict.fromkeys(str(symbol).strip().upper() for symbol in symbols if str(symbol).strip())
        )
        if normalized_symbols:
            params["symbols"] = ",".join(normalized_symbols)
        if normalized_start is not None:
            params["start"] = _format_datetime(normalized_start)
        if normalized_end is not None:
            params["end"] = _format_datetime(normalized_end)
        if page_token:
            params["page_token"] = page_token

        response = await self._get("/v1beta1/news", params)
        payload = response.json()
        if not isinstance(payload, dict) or not isinstance(payload.get("news", []), list):
            raise ProviderPayloadError("Alpaca news response must contain a news array.")

        observed_at = utc_now()
        provenance = Provenance(
            provider="alpaca",
            observed_at=observed_at,
            source_feed="news",
            request_id=_request_id(response),
            delay_seconds=self.capabilities.delay_seconds,
            is_consolidated=None,
        )
        articles = tuple(self._normalize_article(item, provenance) for item in payload.get("news", []))
        next_page_token = payload.get("next_page_token")
        return NewsPage(
            articles=articles,
            next_page_token=str(next_page_token) if next_page_token else None,
            provenance=provenance,
        )

    @staticmethod
    def _normalize_article(
        payload: Mapping[str, Any],
        provenance: Provenance,
    ) -> NewsArticle:
        if not isinstance(payload, dict):
            raise ProviderPayloadError("Each Alpaca news item must be an object.")
        external_id = payload.get("id")
        headline = str(payload.get("headline") or "").strip()
        created_at = parse_datetime(payload.get("created_at"))
        updated_at = parse_datetime(payload.get("updated_at")) or created_at
        if external_id is None or not headline or created_at is None or updated_at is None:
            raise ProviderPayloadError(
                "Alpaca news items require id, headline, created_at, and updated_at."
            )
        return NewsArticle(
            external_id=str(external_id),
            headline=headline,
            provenance=provenance,
            created_at=created_at,
            updated_at=updated_at,
            symbols=tuple(
                symbol.upper() for symbol in string_tuple(payload.get("symbols"))
            ),
            source=_optional_text(payload.get("source")),
            author=_optional_text(payload.get("author")),
            summary=_optional_text(payload.get("summary")),
            url=_optional_text(payload.get("url")),
            content=_optional_text(payload.get("content")),
        )


def _normalize_trade(payload: Any) -> Optional[MarketTrade]:
    if not isinstance(payload, dict):
        return None
    price = optional_float(payload.get("p"))
    if price is None:
        return None
    return MarketTrade(
        price=price,
        size=optional_int(payload.get("s")),
        timestamp=parse_datetime(payload.get("t")),
        exchange=_optional_text(payload.get("x")),
        trade_id=payload.get("i"),
        conditions=string_tuple(payload.get("c")),
    )


def _normalize_quote(payload: Any) -> Optional[MarketQuote]:
    if not isinstance(payload, dict):
        return None
    return MarketQuote(
        bid_price=optional_float(payload.get("bp")),
        bid_size=optional_int(payload.get("bs")),
        ask_price=optional_float(payload.get("ap")),
        ask_size=optional_int(payload.get("as")),
        timestamp=parse_datetime(payload.get("t")),
        bid_exchange=_optional_text(payload.get("bx")),
        ask_exchange=_optional_text(payload.get("ax")),
        conditions=string_tuple(payload.get("c")),
    )


def _normalize_bar(payload: Any) -> Optional[MarketBar]:
    if not isinstance(payload, dict):
        return None
    timestamp = parse_datetime(payload.get("t"))
    required = {
        "open": optional_float(payload.get("o")),
        "high": optional_float(payload.get("h")),
        "low": optional_float(payload.get("l")),
        "close": optional_float(payload.get("c")),
        "volume": optional_int(payload.get("v")),
    }
    if timestamp is None or any(value is None for value in required.values()):
        return None
    return MarketBar(
        timestamp=timestamp,
        open=required["open"],  # type: ignore[arg-type]
        high=required["high"],  # type: ignore[arg-type]
        low=required["low"],  # type: ignore[arg-type]
        close=required["close"],  # type: ignore[arg-type]
        volume=required["volume"],  # type: ignore[arg-type]
        vwap=optional_float(payload.get("vw")),
        trade_count=optional_int(payload.get("n")),
    )


def _optional_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None
