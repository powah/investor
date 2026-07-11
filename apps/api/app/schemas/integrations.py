from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProviderConnectionRead(BaseModel):
    provider: str
    purpose: str
    configured: bool
    enabled: bool
    environment: str
    source_feed: Optional[str] = None
    real_time: bool = False
    is_consolidated: bool = False
    message: str


class IntegrationsStatusRead(BaseModel):
    market_data: ProviderConnectionRead
    news: ProviderConnectionRead
    filings: ProviderConnectionRead
    broker: ProviderConnectionRead


class SymbolSyncRequest(BaseModel):
    symbols: list[str] = Field(default_factory=list, max_length=100)
    feed: Optional[Literal["delayed_sip", "iex", "sip"]] = None


class NewsSyncRequest(BaseModel):
    symbols: list[str] = Field(default_factory=list, max_length=100)
    providers: list[Literal["alpaca", "sec"]] = Field(default_factory=lambda: ["alpaca", "sec"])
    since_hours: int = Field(default=72, ge=1, le=24 * 30)
    limit: int = Field(default=50, ge=1, le=50)


class MarketDataSnapshotRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticker: str
    provider: str
    source_feed: str
    price: float
    bid: Optional[float]
    ask: Optional[float]
    spread_pct: Optional[float]
    volume: Optional[float]
    vwap: Optional[float]
    previous_close: Optional[float]
    event_time: datetime
    observed_at: datetime
    delay_seconds: Optional[int]
    is_consolidated: bool
    request_id: Optional[str]


class ExternalNewsEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    provider: str
    external_id: str
    ticker: str
    source: str
    category: Optional[str]
    headline: str
    summary: Optional[str]
    url: Optional[str]
    published_at: datetime
    updated_at_external: Optional[datetime]
    observed_at: datetime
    promoted_catalyst_id: Optional[int]


class PromoteNewsEventRequest(BaseModel):
    catalyst_type: str = Field(min_length=1, max_length=80)
    quality_score: int = Field(ge=0, le=20)


class SyncProviderResultRead(BaseModel):
    provider: str
    status: Literal["completed", "failed", "skipped"]
    records_count: int = 0
    message: Optional[str] = None


class SyncResultRead(BaseModel):
    results: list[SyncProviderResultRead]
    snapshots: list[MarketDataSnapshotRead] = Field(default_factory=list)
    news_events: list[ExternalNewsEventRead] = Field(default_factory=list)


class AutomationSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    auto_submit_approved: Optional[bool] = None
    require_manual_approval: Optional[bool] = None
    max_orders_per_day: Optional[int] = Field(default=None, ge=1, le=50)
    max_order_notional: Optional[float] = Field(default=None, gt=0)
    max_quote_age_seconds: Optional[int] = Field(default=None, ge=5, le=900)
    max_price_deviation_pct: Optional[float] = Field(default=None, gt=0, le=25)

    @model_validator(mode="after")
    def keep_manual_approval(self):
        if self.require_manual_approval is False:
            raise ValueError("Manual approval is mandatory in the paper-automation release.")
        return self


class AutomationSettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    enabled: bool
    auto_submit_approved: bool
    kill_switch_engaged: bool
    require_manual_approval: bool
    paper_only: bool
    max_orders_per_day: int
    max_order_notional: float
    max_quote_age_seconds: int
    max_price_deviation_pct: float
    allowed_order_types: list[str]
    updated_at: datetime


class KillSwitchUpdate(BaseModel):
    engaged: bool
    confirmation: str = ""

    @model_validator(mode="after")
    def require_release_confirmation(self):
        if not self.engaged and self.confirmation != "ARM PAPER AUTOMATION":
            raise ValueError('Releasing the kill switch requires confirmation "ARM PAPER AUTOMATION".')
        return self


class ExecutionIntentCreate(BaseModel):
    trade_plan_id: int = Field(ge=1)
    order_type: Literal["limit"] = "limit"
    time_in_force: Literal["day"] = "day"


class ExecutionApprovalRequest(BaseModel):
    approval_note: Optional[str] = Field(default=None, max_length=500)
    acknowledge_warnings: bool = False


class ExecutionIntentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    trade_plan_id: int
    broker_provider: str
    status: str
    order_type: str
    time_in_force: str
    quantity: int
    limit_price: float
    stop_price: float
    target_price: Optional[float]
    client_order_id: str
    broker_order_id: Optional[str]
    approval_note: Optional[str]
    approved_at: Optional[datetime]
    submitted_at: Optional[datetime]
    last_reconciled_at: Optional[datetime]
    failure_reason: Optional[str]
    risk_snapshot: dict
    quote_snapshot: dict
    request_payload: dict
    broker_payload: dict
    created_at: datetime
    updated_at: datetime


class ExecutionActionRead(BaseModel):
    intent: ExecutionIntentRead
    blockers: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class BrokerAccountRead(BaseModel):
    provider: str
    environment: str
    account_id: str
    status: str
    currency: Optional[str]
    buying_power: Optional[float]
    cash: Optional[float]
    equity: Optional[float]
    trading_blocked: bool
    account_blocked: bool
    trade_suspended_by_user: bool


class BrokerClockRead(BaseModel):
    provider: str
    timestamp: datetime
    is_open: bool
    next_open: datetime
    next_close: datetime


class BrokerPositionRead(BaseModel):
    provider: str
    symbol: str
    quantity: float
    available_quantity: Optional[float]
    side: str
    average_entry_price: Optional[float]
    current_price: Optional[float]
    market_value: Optional[float]
    unrealized_pl: Optional[float]


class BrokerOrderRead(BaseModel):
    provider: str
    id: str
    client_order_id: str
    symbol: str
    side: str
    order_type: str
    time_in_force: str
    status: str
    quantity: Optional[float]
    filled_quantity: float
    filled_average_price: Optional[float]
    limit_price: Optional[float]
    stop_price: Optional[float]
    submitted_at: Optional[datetime]
    updated_at: Optional[datetime]
    raw: dict = Field(default_factory=dict)


class BrokerSyncRead(BaseModel):
    account: BrokerAccountRead
    clock: BrokerClockRead
    positions: list[BrokerPositionRead]
    orders: list[BrokerOrderRead]


class AutomationRunRead(BaseModel):
    processed: int
    submitted: int
    reconciled: int
    failed: int


class AutomationAuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    action: str
    entity_type: str
    entity_id: Optional[int]
    outcome: str
    message: str
    details: dict
    created_at: datetime
