from __future__ import annotations

from datetime import date, datetime, time
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Float, Integer, JSON, String, Text, Time, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ScannerSymbol(Base):
    __tablename__ = "scanner_symbols"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    ticker: Mapped[str] = mapped_column(String(12), unique=True, index=True)
    price: Mapped[float] = mapped_column(Float)
    gap_pct: Mapped[float] = mapped_column(Float, default=0)
    rel_volume: Mapped[float] = mapped_column(Float, default=0)
    float_m: Mapped[float] = mapped_column(Float, default=0)
    market_cap_m: Mapped[float] = mapped_column(Float, default=0)
    spread_pct: Mapped[float] = mapped_column(Float, default=0)
    catalyst_type: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    above_vwap: Mapped[bool] = mapped_column(Boolean, default=False)
    news_headline: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    clean_daily_chart_room: Mapped[bool] = mapped_column(Boolean, default=True)
    holding_key_level: Mapped[bool] = mapped_column(Boolean, default=True)
    no_dilution_red_flag: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(20), default="candidate")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Catalyst(Base):
    __tablename__ = "catalysts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    ticker: Mapped[str] = mapped_column(String(12), index=True)
    published_time: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    source: Mapped[str] = mapped_column(String(120), default="Manual")
    headline: Mapped[str] = mapped_column(Text)
    catalyst_type: Mapped[str] = mapped_column(String(80))
    quality_score: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    ticker: Mapped[str] = mapped_column(String(12), unique=True, index=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TradePlan(Base):
    __tablename__ = "trade_plans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    plan_date: Mapped[date] = mapped_column(Date, default=date.today, index=True)
    ticker: Mapped[str] = mapped_column(String(12), index=True)
    account_size: Mapped[float] = mapped_column(Float)
    max_risk_per_trade_pct: Mapped[float] = mapped_column(Float)
    entry_price: Mapped[float] = mapped_column(Float)
    stop_price: Mapped[float] = mapped_column(Float)
    target_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    risk_per_share: Mapped[float] = mapped_column(Float)
    shares: Mapped[int] = mapped_column(Integer)
    max_loss: Mapped[float] = mapped_column(Float)
    r_multiple: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    warnings: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class JournalEntry(Base):
    __tablename__ = "journal_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    trade_date: Mapped[date] = mapped_column(Date, default=date.today, index=True)
    ticker: Mapped[str] = mapped_column(String(12), index=True)
    setup: Mapped[str] = mapped_column(String(120), default="Catalyst momentum")
    catalyst_type: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    entry_price: Mapped[float] = mapped_column(Float)
    stop_price: Mapped[float] = mapped_column(Float)
    exit_price: Mapped[float] = mapped_column(Float)
    shares: Mapped[int] = mapped_column(Integer)
    pnl: Mapped[float] = mapped_column(Float)
    r_multiple: Mapped[float] = mapped_column(Float)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    mistake_tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    followed_plan: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RiskSettings(Base):
    __tablename__ = "risk_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    account_size: Mapped[float] = mapped_column(Float, default=10_000)
    max_risk_per_trade_pct: Mapped[float] = mapped_column(Float, default=0.5)
    max_daily_loss: Mapped[float] = mapped_column(Float, default=150)
    max_trades_per_day: Mapped[int] = mapped_column(Integer, default=5)
    max_consecutive_losses: Mapped[int] = mapped_column(Integer, default=3)
    allowed_start_time: Mapped[time] = mapped_column(Time, default=time(9, 30))
    allowed_end_time: Mapped[time] = mapped_column(Time, default=time(16, 0))
    min_score_to_plan: Mapped[int] = mapped_column(Integer, default=65)
    max_spread_pct: Mapped[float] = mapped_column(Float, default=1.5)
    max_position_shares: Mapped[int] = mapped_column(Integer, default=10_000)
    require_above_vwap: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
