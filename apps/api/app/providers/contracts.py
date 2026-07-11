"""Normalized records and structural contracts for external data providers.

Provider-specific payloads stop at these boundaries.  The rest of the
application can therefore persist, score, and display data without importing a
vendor SDK or knowing a vendor's field names.
"""

from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional, Protocol, Sequence, Tuple, Union, runtime_checkable


class ProviderPayloadError(ValueError):
    """Raised when a provider returns a successful but unusable payload."""


@dataclass(frozen=True)
class Provenance:
    provider: str
    observed_at: datetime
    source_feed: Optional[str] = None
    request_id: Optional[str] = None
    delay_seconds: Optional[int] = None
    is_consolidated: Optional[bool] = None


@dataclass(frozen=True)
class MarketDataCapabilities:
    provider: str
    feed: str
    real_time: bool
    delay_seconds: int
    is_consolidated: bool
    coverage: str
    history_start: Optional[date]
    supports_snapshots: bool = True
    supports_streaming: bool = False
    max_stream_symbols: Optional[int] = None


@dataclass(frozen=True)
class NewsProviderCapabilities:
    provider: str
    real_time: bool
    delay_seconds: int
    history_start: Optional[date]
    max_page_size: int
    supports_streaming: bool = False


@dataclass(frozen=True)
class FilingProviderCapabilities:
    provider: str
    real_time: bool
    typical_delay_seconds: Optional[int]
    fair_access_requests_per_second: int
    supports_ticker_map: bool = True
    supports_recent_submissions: bool = True


@dataclass(frozen=True)
class MarketTrade:
    price: float
    size: Optional[int]
    timestamp: Optional[datetime]
    exchange: Optional[str] = None
    trade_id: Optional[Union[str, int]] = None
    conditions: Tuple[str, ...] = ()


@dataclass(frozen=True)
class MarketQuote:
    bid_price: Optional[float]
    bid_size: Optional[int]
    ask_price: Optional[float]
    ask_size: Optional[int]
    timestamp: Optional[datetime]
    bid_exchange: Optional[str] = None
    ask_exchange: Optional[str] = None
    conditions: Tuple[str, ...] = ()


@dataclass(frozen=True)
class MarketBar:
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: int
    vwap: Optional[float] = None
    trade_count: Optional[int] = None


@dataclass(frozen=True)
class MarketSnapshot:
    symbol: str
    provenance: Provenance
    latest_trade: Optional[MarketTrade]
    latest_quote: Optional[MarketQuote]
    minute_bar: Optional[MarketBar]
    daily_bar: Optional[MarketBar]
    previous_daily_bar: Optional[MarketBar]


@dataclass(frozen=True)
class MarketSnapshotBatch:
    snapshots: Tuple[MarketSnapshot, ...]
    provenance: Provenance


@dataclass(frozen=True)
class NewsArticle:
    external_id: str
    headline: str
    provenance: Provenance
    created_at: datetime
    updated_at: datetime
    symbols: Tuple[str, ...]
    source: Optional[str] = None
    author: Optional[str] = None
    summary: Optional[str] = None
    url: Optional[str] = None
    content: Optional[str] = None


@dataclass(frozen=True)
class NewsPage:
    articles: Tuple[NewsArticle, ...]
    next_page_token: Optional[str]
    provenance: Provenance


@dataclass(frozen=True)
class CompanyTicker:
    cik: str
    name: str
    ticker: str
    exchange: Optional[str]
    provenance: Provenance


@dataclass(frozen=True)
class TickerMap:
    entries: Tuple[CompanyTicker, ...]
    provenance: Provenance


@dataclass(frozen=True)
class FilingSubmission:
    cik: str
    company_name: str
    accession_number: str
    form: str
    provenance: Provenance
    filing_date: Optional[date] = None
    report_date: Optional[date] = None
    accepted_at: Optional[datetime] = None
    primary_document: Optional[str] = None
    primary_document_description: Optional[str] = None
    items: Tuple[str, ...] = ()
    is_xbrl: bool = False
    is_inline_xbrl: bool = False
    document_url: Optional[str] = None
    index_url: Optional[str] = None


@dataclass(frozen=True)
class FilingSubmissions:
    cik: str
    company_name: str
    tickers: Tuple[str, ...]
    exchanges: Tuple[str, ...]
    filings: Tuple[FilingSubmission, ...]
    older_history_files: Tuple[str, ...]
    provenance: Provenance


@runtime_checkable
class MarketDataProvider(Protocol):
    @property
    def capabilities(self) -> MarketDataCapabilities:
        ...

    async def get_snapshots(
        self,
        symbols: Sequence[str],
        *,
        feed: Optional[str] = None,
    ) -> MarketSnapshotBatch:
        ...


@runtime_checkable
class NewsProvider(Protocol):
    @property
    def capabilities(self) -> NewsProviderCapabilities:
        ...

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
        ...


@runtime_checkable
class FilingProvider(Protocol):
    @property
    def capabilities(self) -> FilingProviderCapabilities:
        ...

    async def get_ticker_map(self) -> TickerMap:
        ...

    async def get_submissions(self, cik: Union[str, int]) -> FilingSubmissions:
        ...
