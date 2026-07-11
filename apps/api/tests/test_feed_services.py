from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.core.database import Base
from app.models.integrations import ExternalNewsEvent, IntegrationSyncRun, MarketDataSnapshot
from app.providers.contracts import (
    FilingSubmission,
    MarketSnapshot,
    MarketSnapshotBatch,
    MarketTrade,
    NewsArticle,
    NewsPage,
    Provenance,
)
from app.services import feeds


def _run(awaitable):
    return asyncio.run(awaitable)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine, autoflush=False) as session:
        yield session


def _settings(**overrides) -> Settings:
    values = {
        "database_url": "sqlite+pysqlite:///:memory:",
        "alpaca_api_key_id": "paper-key",
        "alpaca_api_secret_key": "paper-secret",
        "alpaca_data_base_url": "https://data.alpaca.markets",
        "alpaca_scanner_feed": "delayed_sip",
        "sec_user_agent": "Investor Tool admin@example.test",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def _provenance(*, source_feed: str = "iex") -> Provenance:
    return Provenance(
        provider="alpaca",
        observed_at=datetime(2026, 7, 11, 15, 0, 1, tzinfo=timezone.utc),
        source_feed=source_feed,
        request_id="request-1",
        delay_seconds=0,
        is_consolidated=False,
    )


def _market_batch() -> MarketSnapshotBatch:
    provenance = _provenance()
    snapshot = MarketSnapshot(
        symbol="AAPL",
        provenance=provenance,
        latest_trade=MarketTrade(
            price=210.0,
            size=10,
            timestamp=datetime(2026, 7, 11, 15, 0, tzinfo=timezone.utc),
        ),
        latest_quote=None,
        minute_bar=None,
        daily_bar=None,
        previous_daily_bar=None,
    )
    return MarketSnapshotBatch(snapshots=(snapshot,), provenance=provenance)


class _FakeMarketProvider:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_value, traceback):
        return None

    async def get_snapshots(self, symbols, *, feed=None):
        return _market_batch()


def test_market_records_and_completed_run_share_one_terminal_commit(db, monkeypatch):
    monkeypatch.setattr(feeds, "AlpacaMarketDataProvider", _FakeMarketProvider)
    original_commit = db.commit
    commit_calls = 0

    def counted_commit():
        nonlocal commit_calls
        commit_calls += 1
        return original_commit()

    monkeypatch.setattr(db, "commit", counted_commit)

    run, records = _run(
        feeds.sync_alpaca_market_data(db, _settings(), ["AAPL"], feed="iex")
    )

    assert commit_calls == 2
    assert run.status == "completed"
    assert run.records_count == 1
    assert len(records) == 1
    assert db.query(MarketDataSnapshot).count() == 1


def test_terminal_commit_failure_rolls_back_records_and_marks_run_failed(db, monkeypatch):
    monkeypatch.setattr(feeds, "AlpacaMarketDataProvider", _FakeMarketProvider)
    original_commit = db.commit
    commit_calls = 0

    def fail_terminal_commit():
        nonlocal commit_calls
        commit_calls += 1
        if commit_calls == 2:
            raise SQLAlchemyError("forced terminal commit failure")
        return original_commit()

    monkeypatch.setattr(db, "commit", fail_terminal_commit)

    with pytest.raises(feeds.IntegrationProviderError, match="forced terminal commit failure"):
        _run(feeds.sync_alpaca_market_data(db, _settings(), ["AAPL"], feed="iex"))

    run = db.query(IntegrationSyncRun).one()
    assert commit_calls == 3
    assert run.status == "failed"
    assert run.records_count == 0
    assert "forced terminal commit failure" in run.error_message
    assert db.query(MarketDataSnapshot).count() == 0


def _article(headline: str, summary: str, *, updated_at: datetime) -> NewsArticle:
    return NewsArticle(
        external_id="article-1",
        headline=headline,
        provenance=_provenance(source_feed="news"),
        created_at=datetime(2026, 7, 11, 13, 0, tzinfo=timezone.utc),
        updated_at=updated_at,
        symbols=("AAPL", "AAPL"),
        source="benzinga",
        summary=summary,
        url="https://example.test/article-1",
    )


def test_news_sync_deduplicates_a_page_and_updates_the_same_row_on_repeat(db, monkeypatch):
    first_update = datetime(2026, 7, 11, 13, 1, tzinfo=timezone.utc)
    second_update = datetime(2026, 7, 11, 13, 2, tzinfo=timezone.utc)
    third_update = datetime(2026, 7, 11, 13, 3, tzinfo=timezone.utc)
    pages = [
        NewsPage(
            articles=(
                _article("Initial headline", "Initial summary", updated_at=first_update),
                _article("Corrected headline", "Corrected summary", updated_at=second_update),
            ),
            next_page_token=None,
            provenance=_provenance(source_feed="news"),
        ),
        NewsPage(
            articles=(
                _article("Final headline", "Final summary", updated_at=third_update),
            ),
            next_page_token=None,
            provenance=_provenance(source_feed="news"),
        ),
    ]

    class FakeNewsProvider:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_value, traceback):
            return None

        async def get_news(self, **kwargs):
            return pages.pop(0)

    monkeypatch.setattr(feeds, "AlpacaNewsProvider", FakeNewsProvider)

    first_run, first_records = _run(
        feeds.sync_alpaca_news(db, _settings(), ["AAPL"], since_hours=24, limit=10)
    )
    first_id = first_records[0].id
    second_run, second_records = _run(
        feeds.sync_alpaca_news(db, _settings(), ["AAPL"], since_hours=24, limit=10)
    )

    assert first_run.records_count == 1
    assert second_run.records_count == 1
    assert len(first_records) == len(second_records) == 1
    assert second_records[0].id == first_id
    assert db.query(ExternalNewsEvent).count() == 1
    persisted = db.query(ExternalNewsEvent).one()
    assert persisted.headline == "Final headline"
    assert persisted.summary == "Final summary"
    assert persisted.updated_at_external == third_update.replace(tzinfo=None)


def test_sec_sync_rejects_uncontactable_user_agent_before_starting_a_run(db):
    with pytest.raises(feeds.IntegrationNotConfigured, match="contact email"):
        _run(
            feeds.sync_sec_filings(
                db,
                _settings(sec_user_agent="anonymous bot"),
                ["AAPL"],
                since_hours=24,
            )
        )

    assert db.query(IntegrationSyncRun).count() == 0


def _filing(
    *,
    filing_date: date | None = None,
    accepted_at: datetime | None = None,
) -> FilingSubmission:
    return FilingSubmission(
        cik="0000320193",
        company_name="Apple Inc.",
        accession_number="0000320193-26-000077",
        form="8-K",
        provenance=Provenance(
            provider="sec_edgar",
            observed_at=datetime(2026, 7, 11, 16, tzinfo=timezone.utc),
            source_feed="submissions",
        ),
        filing_date=filing_date,
        accepted_at=accepted_at,
    )


def test_sec_date_only_window_uses_eastern_calendar_date():
    cutoff = datetime(2026, 7, 11, 15, 0, tzinfo=timezone.utc)
    same_eastern_date = _filing(filing_date=date(2026, 7, 11))
    prior_eastern_date = _filing(filing_date=date(2026, 7, 10))

    assert feeds._filing_time(same_eastern_date) == datetime(
        2026, 7, 11, 4, 0, tzinfo=timezone.utc
    )
    assert feeds._filing_is_within_window(same_eastern_date, cutoff) is True
    assert feeds._filing_is_within_window(prior_eastern_date, cutoff) is False


def test_sec_exact_acceptance_time_uses_instant_comparison():
    cutoff = datetime(2026, 7, 11, 15, 0, tzinfo=timezone.utc)

    assert feeds._filing_is_within_window(_filing(accepted_at=cutoff), cutoff) is True
    assert (
        feeds._filing_is_within_window(
            _filing(accepted_at=cutoff - timedelta(microseconds=1)),
            cutoff,
        )
        is False
    )
