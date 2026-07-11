from __future__ import annotations

from datetime import date, datetime, time
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class ScannerSymbolBase(BaseModel):
    ticker: str = Field(min_length=1, max_length=12)
    price: float
    gap_pct: float = 0
    rel_volume: float = 0
    float_m: float = 0
    market_cap_m: float = 0
    spread_pct: float = 0
    catalyst_type: Optional[str] = None
    above_vwap: bool = False
    news_headline: Optional[str] = None
    clean_daily_chart_room: bool = False
    holding_key_level: bool = False
    no_dilution_red_flag: bool = False


class ScannerSymbolCreate(ScannerSymbolBase):
    pass


class ScannerStatusUpdate(BaseModel):
    status: str = Field(pattern="^(candidate|watch|ignore)$")


class ScannerSymbolRead(ScannerSymbolBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: str
    created_at: datetime
    updated_at: datetime
    score: int
    label: str
    reasons: list[str]
    risk_warnings: list[str]
    latest_catalyst_quality_score: Optional[int]
    latest_catalyst_published_time: Optional[datetime]
    latest_catalyst_is_fresh: bool


class CatalystCreate(BaseModel):
    ticker: str = Field(min_length=1, max_length=12)
    published_time: datetime = Field(default_factory=datetime.utcnow)
    source: str = "Manual"
    headline: str = Field(min_length=1)
    catalyst_type: str = Field(min_length=1)
    quality_score: int = Field(default=0, ge=0, le=20)


class CatalystRead(CatalystCreate):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime


class WatchlistCreate(BaseModel):
    ticker: str = Field(min_length=1, max_length=12)
    notes: Optional[str] = None


class WatchlistRead(BaseModel):
    id: int
    ticker: str
    notes: Optional[str]
    created_at: datetime
    symbol: Optional[ScannerSymbolRead] = None


class TradePlanCreate(BaseModel):
    plan_date: date = Field(default_factory=date.today)
    ticker: str = Field(min_length=1, max_length=12)
    account_size: Optional[float] = Field(default=None, gt=0)
    max_risk_per_trade_pct: Optional[float] = Field(default=None, gt=0, le=100)
    entry_price: float = Field(gt=0)
    stop_price: Optional[float] = Field(default=None, gt=0)
    target_price: Optional[float] = Field(default=None, gt=0)


class TradePlanRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    plan_date: date
    ticker: str
    account_size: float
    max_risk_per_trade_pct: float
    entry_price: float
    stop_price: float
    target_price: Optional[float]
    risk_per_share: float
    shares: int
    max_loss: float
    r_multiple: Optional[float]
    warnings: list[str]
    created_at: datetime


class TradePlanPreviewRead(BaseModel):
    risk_per_share: float
    shares: int
    max_loss: float
    r_multiple: Optional[float]
    warnings: list[str]
    blockers: list[str]


class JournalCreate(BaseModel):
    trade_date: date = Field(default_factory=date.today)
    ticker: str = Field(min_length=1, max_length=12)
    setup: str = "Catalyst momentum"
    catalyst_type: Optional[str] = None
    entry_price: float = Field(gt=0)
    stop_price: float = Field(gt=0)
    exit_price: float = Field(gt=0)
    shares: int = Field(gt=0)
    pnl: Optional[float] = None
    r_multiple: Optional[float] = None
    notes: Optional[str] = None
    mistake_tags: list[str] = Field(default_factory=list)
    followed_plan: bool = True


class JournalRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    trade_date: date
    ticker: str
    setup: str
    catalyst_type: Optional[str]
    entry_price: float
    stop_price: float
    exit_price: float
    shares: int
    pnl: float
    r_multiple: float
    notes: Optional[str]
    mistake_tags: list[str]
    followed_plan: bool
    created_at: datetime


class RiskSettingsUpdate(BaseModel):
    account_size: Optional[float] = Field(default=None, gt=0)
    max_risk_per_trade_pct: Optional[float] = Field(default=None, gt=0, le=100)
    max_daily_loss: Optional[float] = Field(default=None, gt=0)
    max_trades_per_day: Optional[int] = Field(default=None, ge=1)
    max_consecutive_losses: Optional[int] = Field(default=None, ge=1)
    allowed_start_time: Optional[time] = None
    allowed_end_time: Optional[time] = None
    min_score_to_plan: Optional[int] = Field(default=None, ge=0, le=100)
    max_spread_pct: Optional[float] = Field(default=None, gt=0)
    max_position_shares: Optional[int] = Field(default=None, ge=1)
    require_above_vwap: Optional[bool] = None


class RiskSettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_size: float
    max_risk_per_trade_pct: float
    max_daily_loss: float
    max_trades_per_day: int
    max_consecutive_losses: int
    allowed_start_time: time
    allowed_end_time: time
    min_score_to_plan: int
    max_spread_pct: float
    max_position_shares: int
    require_above_vwap: bool
    updated_at: datetime


class AnalyticsRead(BaseModel):
    total_trades: int
    win_rate: float
    average_win: float
    average_loss: float
    net_pnl: float
    average_r: float
    best_catalyst_type: Optional[str]
    most_common_mistake: Optional[str]
