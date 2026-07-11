from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Callable, Iterable, Optional, Sequence
from zoneinfo import ZoneInfo

import httpx
from fastapi.encoders import jsonable_encoder
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.integrations import ExternalNewsEvent, IntegrationSyncRun, MarketDataSnapshot
from app.models.trading import ScannerSymbol, WatchlistItem
from app.providers import (
    AlpacaMarketDataProvider,
    AlpacaNewsProvider,
    SecEdgarProvider,
    validate_sec_user_agent,
)
from app.providers.contracts import FilingSubmission, MarketSnapshot, NewsArticle


RELEVANT_SEC_FORMS = {
    "8-K",
    "8-K/A",
    "6-K",
    "S-1",
    "S-1/A",
    "S-3",
    "S-3/A",
    "424B2",
    "424B3",
    "424B4",
    "424B5",
    "EFFECT",
    "10-Q",
    "10-K",
    "SC 13D",
    "SC 13G",
    "3",
    "4",
    "5",
}
SEC_FILING_TIMEZONE = ZoneInfo("America/New_York")


class IntegrationNotConfigured(RuntimeError):
    pass


class IntegrationProviderError(RuntimeError):
    pass


def normalize_symbols(symbols: Iterable[str], *, limit: int = 30) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_symbol in symbols:
        symbol = str(raw_symbol).strip().upper()
        if not symbol or symbol in seen:
            continue
        normalized.append(symbol)
        seen.add(symbol)
        if len(normalized) >= limit:
            break
    return normalized


def resolve_sync_symbols(db: Session, requested: Sequence[str]) -> list[str]:
    normalized = normalize_symbols(requested)
    if normalized:
        return normalized

    watched = [item.ticker for item in db.query(WatchlistItem).order_by(WatchlistItem.created_at.desc()).all()]
    normalized = normalize_symbols(watched)
    if normalized:
        return normalized

    scanner = [
        symbol.ticker
        for symbol in db.query(ScannerSymbol)
        .filter(ScannerSymbol.status != "ignore")
        .order_by(ScannerSymbol.updated_at.desc())
        .limit(30)
        .all()
    ]
    return normalize_symbols(scanner)


def _start_run(db: Session, provider: str, kind: str, symbols: list[str], metadata: Optional[dict] = None) -> IntegrationSyncRun:
    run = IntegrationSyncRun(
        provider=provider,
        kind=kind,
        status="running",
        requested_symbols=symbols,
        request_metadata=metadata or {},
    )
    db.add(run)
    db.commit()
    return run


def _complete_run(db: Session, run: IntegrationSyncRun, records_count: int) -> None:
    run.status = "completed"
    run.records_count = records_count
    run.completed_at = datetime.now(timezone.utc)
    db.commit()


def _fail_run(db: Session, run: IntegrationSyncRun, exc: Exception) -> None:
    db.rollback()
    run.status = "failed"
    run.error_message = str(exc)[:2_000]
    run.completed_at = datetime.now(timezone.utc)
    db.add(run)
    db.commit()


def _snapshot_price(snapshot: MarketSnapshot) -> Optional[float]:
    if snapshot.latest_trade is not None:
        return snapshot.latest_trade.price
    if snapshot.minute_bar is not None:
        return snapshot.minute_bar.close
    if snapshot.daily_bar is not None:
        return snapshot.daily_bar.close
    return None


def _snapshot_event_time(snapshot: MarketSnapshot) -> datetime:
    candidates = [
        snapshot.latest_trade.timestamp if snapshot.latest_trade else None,
        snapshot.latest_quote.timestamp if snapshot.latest_quote else None,
        snapshot.minute_bar.timestamp if snapshot.minute_bar else None,
        snapshot.daily_bar.timestamp if snapshot.daily_bar else None,
    ]
    return next((candidate for candidate in candidates if candidate is not None), snapshot.provenance.observed_at)


def _persist_snapshot(db: Session, snapshot: MarketSnapshot) -> Optional[MarketDataSnapshot]:
    price = _snapshot_price(snapshot)
    if price is None or price <= 0:
        return None
    quote = snapshot.latest_quote
    bid = quote.bid_price if quote else None
    ask = quote.ask_price if quote else None
    spread_pct = None
    if bid and ask and bid > 0 and ask >= bid:
        midpoint = (bid + ask) / 2
        spread_pct = round(((ask - bid) / midpoint) * 100, 4) if midpoint else None
    vwap = None
    if snapshot.minute_bar and snapshot.minute_bar.vwap:
        vwap = snapshot.minute_bar.vwap
    elif snapshot.daily_bar and snapshot.daily_bar.vwap:
        vwap = snapshot.daily_bar.vwap
    previous_close = snapshot.previous_daily_bar.close if snapshot.previous_daily_bar else None
    event_time = _snapshot_event_time(snapshot)
    observed_at = snapshot.provenance.observed_at
    actual_delay = max(0, int((observed_at - event_time).total_seconds()))
    record = MarketDataSnapshot(
        ticker=snapshot.symbol,
        provider=snapshot.provenance.provider,
        source_feed=snapshot.provenance.source_feed or "unknown",
        price=Decimal(str(price)),
        bid=Decimal(str(bid)) if bid is not None else None,
        ask=Decimal(str(ask)) if ask is not None else None,
        spread_pct=spread_pct,
        volume=float(snapshot.daily_bar.volume) if snapshot.daily_bar else None,
        vwap=Decimal(str(vwap)) if vwap is not None else None,
        previous_close=Decimal(str(previous_close)) if previous_close is not None else None,
        event_time=event_time,
        observed_at=observed_at,
        delay_seconds=max(actual_delay, snapshot.provenance.delay_seconds or 0),
        is_consolidated=bool(snapshot.provenance.is_consolidated),
        request_id=snapshot.provenance.request_id,
        raw_data=jsonable_encoder(asdict(snapshot)),
    )
    db.add(record)

    symbol = db.query(ScannerSymbol).filter(ScannerSymbol.ticker == snapshot.symbol).one_or_none()
    if symbol is not None:
        symbol.price = float(price)
        if previous_close and previous_close > 0:
            symbol.gap_pct = round(((price - previous_close) / previous_close) * 100, 2)
        if spread_pct is not None:
            symbol.spread_pct = spread_pct
        if vwap is not None:
            symbol.above_vwap = price >= vwap
    return record


async def sync_alpaca_market_data(
    db: Session,
    settings: Settings,
    symbols: list[str],
    *,
    feed: Optional[str] = None,
) -> tuple[IntegrationSyncRun, list[MarketDataSnapshot]]:
    if not settings.alpaca_configured:
        raise IntegrationNotConfigured("Alpaca credentials are not configured.")
    selected_feed = feed or settings.alpaca_scanner_feed
    run = _start_run(db, "alpaca", "market_data", symbols, {"feed": selected_feed})
    try:
        async with AlpacaMarketDataProvider(
            settings.alpaca_api_key_id,
            settings.alpaca_api_secret_key,
            feed=selected_feed,
            base_url=settings.alpaca_data_base_url,
        ) as provider:
            batch = await provider.get_snapshots(symbols, feed=selected_feed)
        records = [record for snapshot in batch.snapshots if (record := _persist_snapshot(db, snapshot)) is not None]
        _complete_run(db, run, len(records))
        return run, records
    except (httpx.HTTPError, ValueError, TypeError, SQLAlchemyError) as exc:
        _fail_run(db, run, exc)
        raise IntegrationProviderError(f"Alpaca market-data sync failed: {exc}") from exc


def _find_or_create_external_event(
    db: Session,
    *,
    provider: str,
    external_id: str,
    ticker: str,
    create: Callable[[], ExternalNewsEvent],
) -> ExternalNewsEvent:
    def find_existing() -> Optional[ExternalNewsEvent]:
        return (
            db.query(ExternalNewsEvent)
            .filter(
                ExternalNewsEvent.provider == provider,
                ExternalNewsEvent.external_id == external_id,
                ExternalNewsEvent.ticker == ticker,
            )
            .one_or_none()
        )

    existing = find_existing()
    if existing is not None:
        return existing

    candidate = create()
    try:
        # The savepoint keeps a concurrent unique-key winner from aborting the
        # whole feed transaction. The final run completion still commits all
        # record changes atomically.
        with db.begin_nested():
            db.add(candidate)
            db.flush([candidate])
        return candidate
    except IntegrityError:
        existing = find_existing()
        if existing is None:
            raise
        return existing


def _upsert_news_article(
    db: Session,
    article: NewsArticle,
    requested_symbols: set[str],
    records_by_key: dict[tuple[str, str], ExternalNewsEvent],
) -> None:
    symbols = dict.fromkeys(
        symbol for symbol in article.symbols if not requested_symbols or symbol in requested_symbols
    )
    for ticker in symbols:
        key = (article.external_id, ticker)
        record = records_by_key.get(key)
        if record is None:
            record = _find_or_create_external_event(
                db,
                provider="alpaca",
                external_id=article.external_id,
                ticker=ticker,
                create=lambda ticker=ticker: ExternalNewsEvent(
                    provider="alpaca",
                    external_id=article.external_id,
                    ticker=ticker,
                    source=article.source or "Alpaca News",
                    headline=article.headline,
                    published_at=article.created_at,
                ),
            )
            records_by_key[key] = record
        record.source = article.source or "Alpaca News"
        record.headline = article.headline
        record.summary = article.summary
        record.url = article.url
        record.updated_at_external = article.updated_at
        record.raw_data = jsonable_encoder(asdict(article))


async def sync_alpaca_news(
    db: Session,
    settings: Settings,
    symbols: list[str],
    *,
    since_hours: int,
    limit: int,
) -> tuple[IntegrationSyncRun, list[ExternalNewsEvent]]:
    if not settings.alpaca_configured:
        raise IntegrationNotConfigured("Alpaca credentials are not configured.")
    run = _start_run(db, "alpaca", "news", symbols)
    try:
        start = datetime.now(timezone.utc) - timedelta(hours=since_hours)
        async with AlpacaNewsProvider(
            settings.alpaca_api_key_id,
            settings.alpaca_api_secret_key,
            real_time_access=False,
            base_url=settings.alpaca_data_base_url,
        ) as provider:
            page = await provider.get_news(symbols=symbols, start=start, limit=limit)
        records_by_key: dict[tuple[str, str], ExternalNewsEvent] = {}
        requested = set(symbols)
        for article in page.articles:
            _upsert_news_article(db, article, requested, records_by_key)
        records = list(records_by_key.values())
        _complete_run(db, run, len(records))
        return run, records
    except (httpx.HTTPError, ValueError, TypeError, SQLAlchemyError) as exc:
        _fail_run(db, run, exc)
        raise IntegrationProviderError(f"Alpaca news sync failed: {exc}") from exc


def _filing_time(filing: FilingSubmission) -> Optional[datetime]:
    if filing.accepted_at is not None:
        return filing.accepted_at
    if filing.filing_date is not None:
        return datetime.combine(
            filing.filing_date,
            time.min,
            tzinfo=SEC_FILING_TIMEZONE,
        ).astimezone(timezone.utc)
    return None


def _filing_is_within_window(filing: FilingSubmission, cutoff: datetime) -> bool:
    if filing.accepted_at is not None:
        return filing.accepted_at >= cutoff
    if filing.filing_date is not None:
        return filing.filing_date >= cutoff.astimezone(SEC_FILING_TIMEZONE).date()
    return False


def _upsert_filing(db: Session, ticker: str, filing: FilingSubmission) -> ExternalNewsEvent:
    headline_detail = filing.primary_document_description or filing.primary_document or filing.company_name
    record = _find_or_create_external_event(
        db,
        provider="sec_edgar",
        external_id=filing.accession_number,
        ticker=ticker,
        create=lambda: ExternalNewsEvent(
            provider="sec_edgar",
            external_id=filing.accession_number,
            ticker=ticker,
            source="SEC EDGAR",
            category=filing.form,
            headline=f"SEC {filing.form}: {headline_detail}",
            published_at=_filing_time(filing) or filing.provenance.observed_at,
        ),
    )
    record.category = filing.form
    record.headline = f"SEC {filing.form}: {headline_detail}"
    record.summary = f"Items: {', '.join(filing.items)}" if filing.items else None
    record.url = filing.index_url
    record.raw_data = jsonable_encoder(asdict(filing))
    return record


async def sync_sec_filings(
    db: Session,
    settings: Settings,
    symbols: list[str],
    *,
    since_hours: int,
) -> tuple[IntegrationSyncRun, list[ExternalNewsEvent]]:
    if not settings.sec_configured:
        raise IntegrationNotConfigured(
            "SEC_USER_AGENT must identify the caller and include a contact email address."
        )
    try:
        validate_sec_user_agent(settings.sec_user_agent)
    except ValueError as exc:
        raise IntegrationNotConfigured(
            "SEC_USER_AGENT must identify the caller and include a contact email address."
        ) from exc
    run = _start_run(db, "sec_edgar", "filings", symbols)
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=since_hours)
        async with SecEdgarProvider(settings.sec_user_agent) as provider:
            ticker_map = await provider.get_ticker_map()
            cik_by_ticker = {entry.ticker: entry.cik for entry in ticker_map.entries}
            records: list[ExternalNewsEvent] = []
            for ticker in symbols:
                cik = cik_by_ticker.get(ticker)
                if not cik:
                    continue
                submissions = await provider.get_submissions(cik)
                for filing in submissions.filings:
                    if filing.form not in RELEVANT_SEC_FORMS or not _filing_is_within_window(filing, cutoff):
                        continue
                    records.append(_upsert_filing(db, ticker, filing))
        _complete_run(db, run, len(records))
        return run, records
    except (httpx.HTTPError, ValueError, TypeError, SQLAlchemyError) as exc:
        _fail_run(db, run, exc)
        raise IntegrationProviderError(f"SEC EDGAR sync failed: {exc}") from exc


def latest_market_snapshots(db: Session, *, limit: int = 100) -> list[MarketDataSnapshot]:
    rows = db.query(MarketDataSnapshot).order_by(MarketDataSnapshot.observed_at.desc()).limit(limit * 3).all()
    latest: list[MarketDataSnapshot] = []
    seen: set[tuple[str, str]] = set()
    for row in rows:
        key = (row.provider, row.ticker)
        if key in seen:
            continue
        latest.append(row)
        seen.add(key)
        if len(latest) >= limit:
            break
    return latest


def list_external_news(db: Session, *, limit: int = 100) -> list[ExternalNewsEvent]:
    return db.query(ExternalNewsEvent).order_by(ExternalNewsEvent.published_at.desc()).limit(limit).all()
