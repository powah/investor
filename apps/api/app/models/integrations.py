from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class MarketDataSnapshot(Base):
    __tablename__ = "market_data_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticker: Mapped[str] = mapped_column(String(12), index=True)
    provider: Mapped[str] = mapped_column(String(40), index=True)
    source_feed: Mapped[str] = mapped_column(String(40))
    price: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    bid: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 6), nullable=True)
    ask: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 6), nullable=True)
    spread_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    volume: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    vwap: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 6), nullable=True)
    previous_close: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 6), nullable=True)
    event_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    delay_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_consolidated: Mapped[bool] = mapped_column(Boolean, default=False)
    request_id: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    raw_data: Mapped[dict] = mapped_column(JSON, default=dict)


class ExternalNewsEvent(Base):
    __tablename__ = "external_news_events"
    __table_args__ = (UniqueConstraint("provider", "external_id", "ticker", name="uq_external_news_event"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(40), index=True)
    external_id: Mapped[str] = mapped_column(String(160))
    ticker: Mapped[str] = mapped_column(String(12), index=True)
    source: Mapped[str] = mapped_column(String(160))
    category: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    headline: Mapped[str] = mapped_column(Text)
    summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    updated_at_external: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    promoted_catalyst_id: Mapped[Optional[int]] = mapped_column(ForeignKey("catalysts.id"), nullable=True)
    raw_data: Mapped[dict] = mapped_column(JSON, default=dict)


class IntegrationSyncRun(Base):
    __tablename__ = "integration_sync_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(40), index=True)
    kind: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(30), index=True)
    requested_symbols: Mapped[list[str]] = mapped_column(JSON, default=list)
    records_count: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    request_metadata: Mapped[dict] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class ProviderCapabilityCheck(Base):
    __tablename__ = "provider_capability_checks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(40), index=True)
    capability: Mapped[str] = mapped_column(String(80), index=True)
    endpoint: Mapped[str] = mapped_column(String(200))
    source_feed: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    status: Mapped[str] = mapped_column(String(30), index=True)
    http_status: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    request_id: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    message: Mapped[str] = mapped_column(Text)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    tested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class AutomationSettings(Base):
    __tablename__ = "automation_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_submit_approved: Mapped[bool] = mapped_column(Boolean, default=False)
    kill_switch_engaged: Mapped[bool] = mapped_column(Boolean, default=True)
    require_manual_approval: Mapped[bool] = mapped_column(Boolean, default=True)
    paper_only: Mapped[bool] = mapped_column(Boolean, default=True)
    max_orders_per_day: Mapped[int] = mapped_column(Integer, default=3)
    max_order_notional: Mapped[float] = mapped_column(Float, default=2_500)
    max_quote_age_seconds: Mapped[int] = mapped_column(Integer, default=60)
    max_price_deviation_pct: Mapped[float] = mapped_column(Float, default=2.0)
    allowed_order_types: Mapped[list[str]] = mapped_column(JSON, default=lambda: ["limit"])
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ExecutionIntent(Base):
    __tablename__ = "execution_intents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    trade_plan_id: Mapped[int] = mapped_column(ForeignKey("trade_plans.id"), unique=True, index=True)
    broker_provider: Mapped[str] = mapped_column(String(40), default="alpaca")
    status: Mapped[str] = mapped_column(String(40), default="pending_approval", index=True)
    order_type: Mapped[str] = mapped_column(String(30), default="limit")
    time_in_force: Mapped[str] = mapped_column(String(12), default="day")
    quantity: Mapped[int] = mapped_column(Integer)
    limit_price: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    stop_price: Mapped[Decimal] = mapped_column(Numeric(18, 6))
    target_price: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 6), nullable=True)
    client_order_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    broker_order_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    approval_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_reconciled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    failure_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    risk_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    quote_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    request_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    broker_payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class BrokerOrderEvent(Base):
    __tablename__ = "broker_order_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    execution_intent_id: Mapped[int] = mapped_column(ForeignKey("execution_intents.id"), index=True)
    provider_event_id: Mapped[Optional[str]] = mapped_column(String(160), nullable=True, unique=True)
    event_type: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(60), index=True)
    filled_qty: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 6), nullable=True)
    filled_avg_price: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 6), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    raw_data: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BrokerTradeUpdate(Base):
    """Immutable broker event inbox with mutable processing metadata.

    Source fields are written exactly once. ``processed_at`` and
    ``processing_error`` let a restarted worker resume the small window after
    durable receipt but before execution-state application.
    """

    __tablename__ = "broker_trade_updates"
    __table_args__ = (
        UniqueConstraint("provider", "provider_event_id", name="uq_broker_trade_update_event"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(40), index=True)
    provider_event_id: Mapped[str] = mapped_column(String(200))
    stream: Mapped[str] = mapped_column(String(60), default="trade_updates")
    event_type: Mapped[str] = mapped_column(String(60), index=True)
    broker_order_id: Mapped[str] = mapped_column(String(128), index=True)
    client_order_id: Mapped[str] = mapped_column(String(128), index=True)
    execution_intent_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("execution_intents.id"), nullable=True, index=True
    )
    execution_id: Mapped[Optional[str]] = mapped_column(String(160), nullable=True, index=True)
    price: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 6), nullable=True)
    quantity: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 6), nullable=True)
    position_quantity: Mapped[Optional[Decimal]] = mapped_column(Numeric(18, 6), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    raw_data: Mapped[dict] = mapped_column(JSON, default=dict)
    normalized_order: Mapped[dict] = mapped_column(JSON, default=dict)
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    processing_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class BrokerStreamState(Base):
    __tablename__ = "broker_stream_states"

    provider: Mapped[str] = mapped_column(String(40), primary_key=True)
    environment: Mapped[str] = mapped_column(String(30), default="paper")
    status: Mapped[str] = mapped_column(String(40), default="disabled", index=True)
    last_connected_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_disconnected_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_event_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_backfill_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reconnect_count: Mapped[int] = mapped_column(Integer, default=0)
    events_received: Mapped[int] = mapped_column(Integer, default=0)
    events_processed: Mapped[int] = mapped_column(Integer, default=0)
    duplicate_events: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AutomationAuditLog(Base):
    __tablename__ = "automation_audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    entity_type: Mapped[str] = mapped_column(String(60))
    entity_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    outcome: Mapped[str] = mapped_column(String(40), index=True)
    message: Mapped[str] = mapped_column(Text)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
