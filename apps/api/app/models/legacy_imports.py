from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class LegacyImport(Base):
    __tablename__ = "legacy_imports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_scanner_symbol_id: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    ticker: Mapped[str] = mapped_column(String(12), nullable=False, index=True)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    gap_pct: Mapped[float] = mapped_column(Float, nullable=False)
    rel_volume: Mapped[float] = mapped_column(Float, nullable=False)
    float_m: Mapped[float] = mapped_column(Float, nullable=False)
    market_cap_m: Mapped[float] = mapped_column(Float, nullable=False)
    spread_pct: Mapped[float] = mapped_column(Float, nullable=False)
    catalyst_type: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    above_vwap: Mapped[bool] = mapped_column(Boolean, nullable=False)
    news_headline: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    clean_daily_chart_room: Mapped[bool] = mapped_column(Boolean, nullable=False)
    holding_key_level: Mapped[bool] = mapped_column(Boolean, nullable=False)
    no_dilution_red_flag: Mapped[bool] = mapped_column(Boolean, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    data_origin: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    original_created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    original_updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source_provenance: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    trading_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    market_phase: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    source_timestamp: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
