from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import logging
from typing import Optional
from zoneinfo import ZoneInfo

import httpx
from fastapi.encoders import jsonable_encoder
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.models.integrations import (
    AutomationAuditLog,
    AutomationSettings,
    BrokerOrderEvent,
    ExecutionIntent,
)
from app.models.trading import Catalyst, JournalEntry, RiskSettings, ScannerSymbol, TradePlan
from app.providers import AlpacaMarketDataProvider
from app.providers.broker import (
    BrokerNotFoundError,
    BrokerOrder,
    BrokerOrderRejectedError,
    BrokerOrderRequest,
    BrokerProvider,
    BrokerProviderError,
)
from app.providers.contracts import MarketDataProvider, MarketSnapshot, ProviderPayloadError
from app.services.brokers import BrokerNotConfigured, UnsafeBrokerConfiguration, create_broker
from app.services.risk import evaluate_trade_plan
from app.services.seed import ensure_risk_settings


ACTIVE_INTENT_STATUSES = {
    "approved",
    "submitting",
    "submission_unknown",
    "submitted",
    "partially_filled",
    "entry_filled_protected",
    "protection_failed",
}
RECONCILABLE_INTENT_STATUSES = {
    "submitting",
    "submission_unknown",
    "submitted",
    "partially_filled",
    "entry_filled_protected",
    "protection_failed",
}
TERMINAL_BROKER_STATUSES = {
    "filled",
    "canceled",
    "expired",
    "rejected",
    "replaced",
    "done_for_day",
}
LIVE_BROKER_STATUSES = {
    "new",
    "accepted",
    "pending_new",
    "accepted_for_bidding",
    "held",
    "partially_filled",
    "pending_cancel",
    "pending_replace",
    "calculated",
}
NEW_YORK = ZoneInfo("America/New_York")
EXECUTION_GATE_KEY = 4_242_424_201
logger = logging.getLogger(__name__)


class AutomationNotFound(RuntimeError):
    pass


@dataclass(frozen=True)
class AutomationDecision:
    intent: ExecutionIntent
    blockers: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class AutomationRunStats:
    processed: int = 0
    submitted: int = 0
    reconciled: int = 0
    failed: int = 0


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _audit(
    db: Session,
    *,
    action: str,
    entity_type: str,
    entity_id: Optional[int],
    outcome: str,
    message: str,
    details: Optional[dict] = None,
) -> None:
    db.add(
        AutomationAuditLog(
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            outcome=outcome,
            message=message,
            details=jsonable_encoder(details or {}),
        )
    )


def ensure_automation_settings(
    db: Session,
    defaults: Optional[Settings] = None,
    *,
    lock: bool = False,
) -> AutomationSettings:
    query = db.query(AutomationSettings).filter(AutomationSettings.id == 1)
    if lock:
        query = query.with_for_update().populate_existing()
    settings = query.one_or_none()
    if settings is None:
        configured_defaults = defaults or get_settings()
        settings = AutomationSettings(
            id=1,
            max_quote_age_seconds=configured_defaults.automation_quote_max_age_seconds,
            max_price_deviation_pct=configured_defaults.automation_max_price_deviation_pct,
        )
        db.add(settings)
        db.commit()
        db.refresh(settings)
        if lock:
            settings = (
                db.query(AutomationSettings)
                .filter(AutomationSettings.id == 1)
                .with_for_update()
                .populate_existing()
                .one()
            )
    return settings


def _acquire_execution_gate(db: Session, *, wait: bool) -> bool:
    """Acquire the cross-process paper-execution transaction gate.

    Async submission/reconciliation paths use PostgreSQL's non-blocking form
    so a contended gate never blocks the event loop. Synchronous settings and
    kill-switch routes may wait in FastAPI's worker thread. SQLite tests do not
    have advisory locks and execute sequentially.
    """

    if db.get_bind().dialect.name != "postgresql":
        return True
    if wait:
        db.execute(
            text("SELECT pg_advisory_xact_lock(:key)"),
            {"key": EXECUTION_GATE_KEY},
        )
        return True
    return bool(
        db.execute(
            text("SELECT pg_try_advisory_xact_lock(:key)"),
            {"key": EXECUTION_GATE_KEY},
        ).scalar_one()
    )


def update_automation_settings(db: Session, changes: dict) -> AutomationSettings:
    ensure_automation_settings(db)
    _acquire_execution_gate(db, wait=True)
    automation = ensure_automation_settings(db, lock=True)
    for field, value in changes.items():
        if value is None:
            continue
        if field == "require_manual_approval" and value is not True:
            raise ValueError("Manual approval is mandatory in the paper-automation release.")
        setattr(automation, field, value)
    automation.require_manual_approval = True
    automation.paper_only = True
    automation.allowed_order_types = ["limit"]
    _audit(
        db,
        action="settings_updated",
        entity_type="automation_settings",
        entity_id=automation.id,
        outcome="completed",
        message="Paper automation settings updated.",
        details={key: value for key, value in changes.items() if value is not None},
    )
    db.commit()
    db.refresh(automation)
    return automation


def update_kill_switch(
    db: Session,
    *,
    engaged: bool,
    confirmation: str = "",
) -> AutomationSettings:
    if not engaged and confirmation != "ARM PAPER AUTOMATION":
        raise ValueError('Releasing the kill switch requires confirmation "ARM PAPER AUTOMATION".')
    ensure_automation_settings(db)
    _acquire_execution_gate(db, wait=True)
    automation = ensure_automation_settings(db, lock=True)
    automation.kill_switch_engaged = engaged
    _audit(
        db,
        action="kill_switch_engaged" if engaged else "kill_switch_released",
        entity_type="automation_settings",
        entity_id=automation.id,
        outcome="completed",
        message=(
            "Kill switch engaged; no new paper orders may be submitted."
            if engaged
            else "Kill switch released for explicitly approved paper orders."
        ),
    )
    db.commit()
    db.refresh(automation)
    return automation


def _get_intent(db: Session, intent_id: int, *, lock: bool = False) -> ExecutionIntent:
    query = db.query(ExecutionIntent).filter(ExecutionIntent.id == intent_id)
    if lock:
        query = query.with_for_update().populate_existing()
    intent = query.one_or_none()
    if intent is None:
        raise AutomationNotFound("Execution intent not found.")
    return intent


def _get_plan(db: Session, trade_plan_id: int) -> TradePlan:
    plan = db.get(TradePlan, trade_plan_id)
    if plan is None:
        raise AutomationNotFound("Trade plan not found.")
    return plan


def _client_order_id(plan: TradePlan) -> str:
    return f"catalyst-desk-plan-{plan.id}-v1"


def _static_plan_review(plan: TradePlan, automation: AutomationSettings) -> tuple[list[str], list[str]]:
    blockers: list[str] = []
    warnings = list(plan.warnings or [])
    if plan.entry_price <= 0:
        blockers.append("Entry price must be positive.")
    if plan.stop_price <= 0 or plan.stop_price >= plan.entry_price:
        blockers.append("The protective stop must be below the entry price.")
    if plan.target_price is not None and plan.target_price <= plan.entry_price:
        blockers.append("A bracket take-profit must be above the entry price.")
    if plan.shares <= 0:
        blockers.append("Position size must be at least one share.")
    notional = Decimal(str(plan.entry_price)) * Decimal(plan.shares)
    if notional > Decimal(str(automation.max_order_notional)):
        blockers.append(
            f"Planned notional ${notional:,.2f} exceeds the automation limit "
            f"of ${automation.max_order_notional:,.2f}."
        )
    return blockers, warnings


def create_execution_intent(
    db: Session,
    trade_plan_id: int,
    *,
    order_type: str = "limit",
    time_in_force: str = "day",
) -> AutomationDecision:
    plan = _get_plan(db, trade_plan_id)
    existing = db.query(ExecutionIntent).filter(ExecutionIntent.trade_plan_id == trade_plan_id).one_or_none()
    if existing is not None:
        return AutomationDecision(existing, warnings=("This trade plan already has an execution review.",))
    if order_type != "limit":
        raise ValueError("Only limit entries are supported.")
    if time_in_force != "day":
        raise ValueError("The paper-automation release supports day orders only.")

    automation = ensure_automation_settings(db)
    blockers, warnings = _current_plan_risk_review(db, plan, automation)
    intent = ExecutionIntent(
        trade_plan_id=plan.id,
        broker_provider="alpaca",
        status="pending_approval",
        order_type="limit",
        time_in_force="day",
        quantity=plan.shares,
        limit_price=Decimal(str(plan.entry_price)),
        stop_price=Decimal(str(plan.stop_price)),
        target_price=Decimal(str(plan.target_price)) if plan.target_price is not None else None,
        client_order_id=_client_order_id(plan),
        risk_snapshot=jsonable_encoder(
            {
                "plan_date": plan.plan_date,
                "account_size": plan.account_size,
                "max_risk_per_trade_pct": plan.max_risk_per_trade_pct,
                "risk_per_share": plan.risk_per_share,
                "max_loss": plan.max_loss,
                "r_multiple": plan.r_multiple,
                "plan_warnings": plan.warnings or [],
                "blockers": blockers,
                "warnings": warnings,
                "max_order_notional": automation.max_order_notional,
            }
        ),
    )
    db.add(intent)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        existing = (
            db.query(ExecutionIntent)
            .filter(ExecutionIntent.trade_plan_id == trade_plan_id)
            .one_or_none()
        )
        if existing is None:
            raise
        return AutomationDecision(
            existing,
            warnings=("This trade plan already has an execution review.",),
        )
    _audit(
        db,
        action="intent_created",
        entity_type="execution_intent",
        entity_id=intent.id,
        outcome="blocked" if blockers else "pending_approval",
        message="Protected paper order prepared for review.",
        details={"blockers": blockers, "warnings": warnings, "client_order_id": intent.client_order_id},
    )
    db.commit()
    db.refresh(intent)
    return AutomationDecision(intent, tuple(blockers), tuple(warnings))


def approve_execution_intent(
    db: Session,
    intent_id: int,
    *,
    acknowledge_warnings: bool,
    approval_note: Optional[str] = None,
) -> AutomationDecision:
    automation = ensure_automation_settings(db)
    intent = _get_intent(db, intent_id, lock=True)
    if intent.status in {
        "approved",
        "submitting",
        "submission_unknown",
        "submitted",
        "partially_filled",
        "entry_filled_protected",
        "protection_failed",
        "filled",
    }:
        return AutomationDecision(intent, warnings=("This execution review has already moved past approval.",))
    if intent.status in TERMINAL_BROKER_STATUSES:
        return AutomationDecision(intent, blockers=(f"Intent is already {intent.status}.",))

    plan = _get_plan(db, intent.trade_plan_id)
    blockers, warnings = _current_plan_risk_review(db, plan, automation)
    if warnings and not acknowledge_warnings:
        blockers.append("Acknowledge the trade-plan warnings before approving this paper order.")
    if blockers:
        intent.risk_snapshot = {
            **(intent.risk_snapshot or {}),
            "blockers": blockers,
            "warnings": warnings,
        }
        _audit(
            db,
            action="intent_approval",
            entity_type="execution_intent",
            entity_id=intent.id,
            outcome="blocked",
            message="Paper order approval was blocked.",
            details={"blockers": blockers, "warnings": warnings},
        )
        db.commit()
        db.refresh(intent)
        return AutomationDecision(intent, tuple(blockers), tuple(warnings))

    intent.status = "approved"
    intent.approved_at = _now()
    intent.approval_note = approval_note
    intent.failure_reason = None
    intent.risk_snapshot = {
        **(intent.risk_snapshot or {}),
        "blockers": [],
        "warnings": warnings,
    }
    _audit(
        db,
        action="intent_approved",
        entity_type="execution_intent",
        entity_id=intent.id,
        outcome="completed",
        message="Paper order approved; submission remains subject to live preflight checks.",
        details={"warnings_acknowledged": acknowledge_warnings, "approval_note": approval_note},
    )
    db.commit()
    db.refresh(intent)
    return AutomationDecision(intent, warnings=tuple(warnings))


def _latest_catalyst(db: Session, ticker: str) -> Optional[Catalyst]:
    return (
        db.query(Catalyst)
        .filter(Catalyst.ticker == ticker)
        .order_by(Catalyst.published_time.desc(), Catalyst.id.desc())
        .first()
    )


def _current_plan_risk_review(
    db: Session,
    plan: TradePlan,
    automation: AutomationSettings,
) -> tuple[list[str], list[str]]:
    blockers, warnings = _static_plan_review(plan, automation)
    risk_settings: RiskSettings = ensure_risk_settings(db)
    scanner_symbol = db.query(ScannerSymbol).filter(ScannerSymbol.ticker == plan.ticker).one_or_none()
    entries = db.query(JournalEntry).order_by(JournalEntry.trade_date.desc(), JournalEntry.id.desc()).all()
    current_risk = evaluate_trade_plan(
        ticker=plan.ticker,
        trade_date=plan.plan_date,
        account_size=plan.account_size,
        max_risk_per_trade_pct=plan.max_risk_per_trade_pct,
        entry_price=plan.entry_price,
        stop_price=plan.stop_price,
        target_price=plan.target_price,
        symbol=scanner_symbol,
        catalyst=_latest_catalyst(db, plan.ticker),
        settings=risk_settings,
        journal_entries=entries,
    )
    blockers.extend(blocker for blocker in current_risk.blockers if blocker not in blockers)
    warnings.extend(warning for warning in current_risk.warnings if warning not in warnings)
    if plan.max_risk_per_trade_pct > risk_settings.max_risk_per_trade_pct:
        blockers.append("The saved plan exceeds the current max-risk-per-trade setting.")
    return blockers, warnings


def _local_preflight(
    db: Session,
    intent: ExecutionIntent,
    plan: TradePlan,
    automation: AutomationSettings,
    app_settings: Settings,
) -> tuple[list[str], list[str]]:
    blockers, warnings = _current_plan_risk_review(db, plan, automation)
    if app_settings.allow_live_trading or not app_settings.alpaca_paper_mode:
        blockers.append("Live or non-paper broker configuration is hard-blocked in this release.")
    if app_settings.alpaca_execution_feed != "iex":
        blockers.append("This free-source release permits only the Alpaca IEX execution feed.")
    if not app_settings.alpaca_configured:
        blockers.append("Alpaca paper credentials are not configured.")
    if not automation.paper_only:
        blockers.append("Automation must remain paper-only.")
    if not automation.enabled:
        blockers.append("Paper automation is disabled in Operations settings.")
    if automation.kill_switch_engaged:
        blockers.append("The automation kill switch is engaged.")
    if automation.require_manual_approval and intent.status != "approved":
        blockers.append("This paper order has not been explicitly approved.")
    if intent.order_type not in automation.allowed_order_types or intent.order_type != "limit":
        blockers.append("Only limit entries are allowed.")
    approved_warnings = {
        str(item) for item in (intent.risk_snapshot or {}).get("warnings", [])
    }
    current_warnings = {str(item) for item in warnings}
    if intent.status == "approved" and current_warnings != approved_warnings:
        blockers.append(
            "Risk warnings changed after approval; review and approve the paper order again."
        )

    duplicate = (
        db.query(ExecutionIntent)
        .join(TradePlan, TradePlan.id == ExecutionIntent.trade_plan_id)
        .filter(
            ExecutionIntent.id != intent.id,
            ExecutionIntent.status.in_(ACTIVE_INTENT_STATUSES),
            TradePlan.ticker == plan.ticker,
        )
        .first()
    )
    if duplicate is not None:
        blockers.append(f"Another active execution review already exists for {plan.ticker}.")
    return blockers, warnings


def _snapshot_quote(
    snapshot: MarketSnapshot,
    *,
    intent: ExecutionIntent,
    automation: AutomationSettings,
    risk_settings: RiskSettings,
    expected_feed: str,
) -> tuple[dict, list[str]]:
    blockers: list[str] = []
    if snapshot.provenance.source_feed != expected_feed:
        blockers.append("The snapshot provenance does not match the configured execution feed.")
    if snapshot.provenance.delay_seconds not in {0, None}:
        blockers.append("The snapshot provenance reports delayed data; execution requires real-time data.")
    quote = snapshot.latest_quote
    if quote is None or quote.bid_price is None or quote.ask_price is None:
        return {}, ["A current two-sided execution quote is unavailable."]
    bid = Decimal(str(quote.bid_price))
    ask = Decimal(str(quote.ask_price))
    if bid <= 0 or ask <= 0 or ask < bid:
        return {}, ["The execution quote has an invalid bid/ask market."]
    if quote.timestamp is None:
        blockers.append("The execution quote has no provider timestamp.")
        quote_age = None
    else:
        quote_age = (_now() - _aware(quote.timestamp)).total_seconds()
        if quote_age < -5:
            blockers.append("The execution quote timestamp is implausibly in the future.")
        quote_age = max(0.0, quote_age)
        if quote_age > automation.max_quote_age_seconds:
            blockers.append(
                f"Execution quote is {quote_age:.0f}s old; the limit is {automation.max_quote_age_seconds}s."
            )
    midpoint = (bid + ask) / Decimal("2")
    spread_pct = ((ask - bid) / midpoint * Decimal("100")) if midpoint else Decimal("0")
    if spread_pct > Decimal(str(risk_settings.max_spread_pct)):
        blockers.append(
            f"Current spread is {spread_pct:.2f}%, wider than the {risk_settings.max_spread_pct:.2f}% risk limit."
        )
    deviation_pct = abs(midpoint - intent.limit_price) / intent.limit_price * Decimal("100")
    if deviation_pct > Decimal(str(automation.max_price_deviation_pct)):
        blockers.append(
            f"Current midpoint moved {deviation_pct:.2f}% from the planned entry; "
            f"the automation limit is {automation.max_price_deviation_pct:.2f}%."
        )
    vwap = snapshot.minute_bar.vwap if snapshot.minute_bar else None
    if risk_settings.require_above_vwap:
        if vwap is None:
            blockers.append("VWAP confirmation is required but unavailable in the execution snapshot.")
        elif midpoint < Decimal(str(vwap)):
            blockers.append("Current price is below VWAP while VWAP confirmation is required.")

    quote_snapshot = jsonable_encoder(
        {
            "provider": snapshot.provenance.provider,
            "source_feed": snapshot.provenance.source_feed,
            "is_consolidated": snapshot.provenance.is_consolidated,
            "observed_at": snapshot.provenance.observed_at,
            "event_time": quote.timestamp,
            "quote_age_seconds": quote_age,
            "bid": bid,
            "ask": ask,
            "midpoint": midpoint,
            "spread_pct": spread_pct,
            "planned_limit": intent.limit_price,
            "price_deviation_pct": deviation_pct,
            "vwap": vwap,
            "request_id": snapshot.provenance.request_id,
        }
    )
    return quote_snapshot, blockers


def _order_request(intent: ExecutionIntent, plan: TradePlan) -> BrokerOrderRequest:
    return BrokerOrderRequest(
        symbol=plan.ticker,
        quantity=Decimal(intent.quantity),
        side="buy",
        limit_price=intent.limit_price,
        time_in_force=intent.time_in_force,
        client_order_id=intent.client_order_id,
        order_class="bracket" if intent.target_price is not None else "oto",
        take_profit_limit_price=intent.target_price,
        stop_loss_stop_price=intent.stop_price,
    )


def _canonical_intent_status(intent: ExecutionIntent, order: BrokerOrder) -> str:
    broker_status = order.status.strip().lower()
    current = intent.status
    if current == "filled":
        return current
    if broker_status == "filled" and order.order_class in {"bracket", "oto"}:
        if any(leg.status.strip().lower() == "filled" for leg in order.legs):
            return "filled"
        stop_legs = tuple(
            leg
            for leg in order.legs
            if leg.order_type.strip().lower() in {"stop", "stop_limit", "trailing_stop"}
            or leg.stop_price is not None
        )
        if stop_legs and any(
            leg.status.strip().lower() in LIVE_BROKER_STATUSES for leg in stop_legs
        ):
            return "entry_filled_protected"
        return "protection_failed"
    if current in TERMINAL_BROKER_STATUSES:
        return current
    if broker_status in TERMINAL_BROKER_STATUSES:
        return broker_status
    if broker_status == "partially_filled":
        return "partially_filled"

    rank = {
        "submitting": 0,
        "submission_unknown": 0,
        "submitted": 1,
        "partially_filled": 2,
        "entry_filled_protected": 3,
        "protection_failed": 3,
    }
    proposed = "submitted"
    return current if rank.get(current, -1) > rank[proposed] else proposed


async def _expand_protected_order(
    broker: BrokerProvider,
    order: BrokerOrder,
) -> BrokerOrder:
    if (
        order.order_class not in {"bracket", "oto"}
        or order.status.strip().lower() != "filled"
        or order.legs
    ):
        return order
    get_order = getattr(broker, "get_order", None)
    if get_order is None:
        return order
    try:
        return await get_order(order.id, nested=True)
    except BrokerProviderError:
        logger.warning(
            "Could not retrieve nested protective legs for broker order %s; failing closed.",
            order.id,
        )
        return order


def _record_broker_order(db: Session, intent: ExecutionIntent, order: BrokerOrder) -> None:
    normalized_status = order.status.strip().lower()
    intent.status = _canonical_intent_status(intent, order)
    intent.broker_order_id = order.id
    intent.submitted_at = intent.submitted_at or order.submitted_at or _now()
    intent.last_reconciled_at = _now()
    if intent.status == "protection_failed":
        intent.failure_reason = (
            "The entry is filled but an active protective stop was not confirmed. "
            "Keep the kill switch engaged and inspect the paper broker immediately."
        )
    elif intent.status in {"rejected", "canceled", "expired", "done_for_day"}:
        intent.failure_reason = f"The broker reports order status {intent.status}."
    else:
        intent.failure_reason = None
    intent.broker_payload = jsonable_encoder(asdict(order))

    occurred_at = order.updated_at or order.submitted_at or _now()
    fingerprint = hashlib.sha256(
        json.dumps(intent.broker_payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()[:20]
    provider_event_id = f"alpaca:{order.id}:{fingerprint}"
    exists = db.query(BrokerOrderEvent).filter(BrokerOrderEvent.provider_event_id == provider_event_id).first()
    if exists is None:
        db.add(
            BrokerOrderEvent(
                execution_intent_id=intent.id,
                provider_event_id=provider_event_id,
                event_type="order_reconciled",
                status=normalized_status,
                filled_qty=order.filled_quantity,
                filled_avg_price=order.filled_average_price,
                occurred_at=occurred_at,
                raw_data=jsonable_encoder(asdict(order)),
            )
        )


def _engage_kill_for_protection_failure(
    db: Session,
    intent: ExecutionIntent,
    automation: AutomationSettings,
    *,
    broker_order_id: str,
) -> None:
    if intent.status != "protection_failed":
        return
    was_engaged = automation.kill_switch_engaged
    automation.kill_switch_engaged = True
    already_recorded = (
        db.query(AutomationAuditLog)
        .filter(
            AutomationAuditLog.action == "protective_stop_missing",
            AutomationAuditLog.entity_type == "execution_intent",
            AutomationAuditLog.entity_id == intent.id,
        )
        .first()
    )
    if already_recorded is not None:
        return
    _audit(
        db,
        action="protective_stop_missing",
        entity_type="execution_intent",
        entity_id=intent.id,
        outcome="blocked",
        message=(
            "An active protective stop was not confirmed after entry fill; "
            "the global kill switch is engaged."
        ),
        details={
            "broker_order_id": broker_order_id,
            "kill_switch_was_already_engaged": was_engaged,
        },
    )


async def expand_protected_order(broker: BrokerProvider, order: BrokerOrder) -> BrokerOrder:
    """Public stream/reconciliation hook for fail-closed protected-order checks."""

    return await _expand_protected_order(broker, order)


def apply_broker_order_state(db: Session, intent: ExecutionIntent, order: BrokerOrder) -> None:
    """Apply a normalized broker snapshot monotonically to an execution intent."""

    _record_broker_order(db, intent, order)


def engage_kill_for_protection_failure(
    db: Session,
    intent: ExecutionIntent,
    automation: AutomationSettings,
    *,
    broker_order_id: str,
) -> None:
    _engage_kill_for_protection_failure(
        db,
        intent,
        automation,
        broker_order_id=broker_order_id,
    )


def _quote_snapshot_blockers(
    intent: ExecutionIntent,
    automation: AutomationSettings,
    app_settings: Settings,
) -> list[str]:
    snapshot = intent.quote_snapshot or {}
    blockers: list[str] = []
    if snapshot.get("source_feed") != app_settings.alpaca_execution_feed:
        blockers.append("The saved quote does not match the configured execution feed.")
    event_time = snapshot.get("event_time")
    if not event_time:
        return [*blockers, "The saved execution quote has no provider timestamp."]
    try:
        parsed = datetime.fromisoformat(str(event_time).replace("Z", "+00:00"))
        age_seconds = (_now() - _aware(parsed)).total_seconds()
    except (TypeError, ValueError):
        return [*blockers, "The saved execution quote timestamp is invalid."]
    if age_seconds < -5:
        blockers.append("The saved execution quote timestamp is implausibly in the future.")
    elif age_seconds > automation.max_quote_age_seconds:
        blockers.append(
            f"The execution quote became stale before dispatch; the limit is "
            f"{automation.max_quote_age_seconds}s."
        )
    return blockers


def _daily_submission_count(db: Session, trading_date) -> int:
    return sum(
        1
        for other in db.query(ExecutionIntent).filter(ExecutionIntent.submitted_at.is_not(None)).all()
        if other.submitted_at
        and _aware(other.submitted_at).astimezone(NEW_YORK).date() == trading_date
    )


async def _safe_close(provider: object, *, label: str) -> None:
    close = getattr(provider, "aclose", None)
    if close is None:
        return
    try:
        await close()
    except Exception:
        logger.exception("Failed to close the %s provider cleanly.", label)


def _persist_submission_block(
    db: Session,
    intent: ExecutionIntent,
    blockers: list[str],
    warnings: list[str],
    *,
    message: str,
) -> AutomationDecision:
    if any("warnings changed after approval" in blocker.lower() for blocker in blockers):
        intent.status = "pending_approval"
        intent.approved_at = None
    intent.risk_snapshot = {
        **(intent.risk_snapshot or {}),
        "blockers": blockers,
        "warnings": warnings,
    }
    _audit(
        db,
        action="submission_preflight",
        entity_type="execution_intent",
        entity_id=intent.id,
        outcome="blocked",
        message=message,
        details={"blockers": blockers, "warnings": warnings, "quote": intent.quote_snapshot},
    )
    db.commit()
    db.refresh(intent)
    return AutomationDecision(intent, tuple(blockers), tuple(warnings))


def _persist_submission_unknown(
    db: Session,
    intent: ExecutionIntent,
    reason: str,
) -> AutomationDecision:
    intent.status = "submission_unknown"
    intent.submitted_at = intent.submitted_at or _now()
    intent.failure_reason = (
        "Submission outcome is unknown. Reconciliation will query the deterministic client "
        "order ID; the order will not be retried blindly."
    )
    _audit(
        db,
        action="submission_unknown",
        entity_type="execution_intent",
        entity_id=intent.id,
        outcome="unknown",
        message=intent.failure_reason,
        details={"client_order_id": intent.client_order_id, "reason": reason},
    )
    db.commit()
    db.refresh(intent)
    return AutomationDecision(intent, warnings=(intent.failure_reason,))


async def submit_execution_intent(
    db: Session,
    intent_id: int,
    app_settings: Settings,
    *,
    broker: Optional[BrokerProvider] = None,
    market_provider: Optional[MarketDataProvider] = None,
) -> AutomationDecision:
    # Initialize singleton rows before taking execution locks. The ensure
    # helpers may commit only while bootstrapping a new database.
    automation = ensure_automation_settings(db, app_settings)
    ensure_risk_settings(db)
    intent = _get_intent(db, intent_id)
    plan = _get_plan(db, intent.trade_plan_id)
    if intent.status != "approved":
        message = (
            "This intent may not be resubmitted; reconcile it by client order ID."
            if intent.status in RECONCILABLE_INTENT_STATUSES or intent.status == "filled"
            else "This paper order must be approved before submission."
        )
        return AutomationDecision(intent, blockers=(message,))

    blockers, warnings = _local_preflight(db, intent, plan, automation, app_settings)
    if blockers:
        return _persist_submission_block(
            db,
            intent,
            blockers,
            warnings,
            message="Paper order submission was blocked before contacting the broker.",
        )

    own_broker = broker is None
    own_market = market_provider is None
    dispatch_started = False
    try:
        if broker is None:
            broker = create_broker(app_settings)
        if not broker.paper_trading:
            return _persist_submission_block(
                db,
                intent,
                ["The selected broker adapter is not in paper mode."],
                warnings,
                message="Paper order submission was blocked by broker configuration.",
            )

        # Recover acceptance from an earlier crash or ambiguous response before
        # doing anything that could create a new order.
        try:
            existing_order = await broker.get_order_by_client_id(intent.client_order_id)
        except BrokerNotFoundError:
            existing_order = None
        except BrokerProviderError as exc:
            return _persist_submission_block(
                db,
                intent,
                [f"Broker idempotency lookup failed; no order was sent: {exc}"],
                warnings,
                message=(
                    "Paper order submission stopped because existing broker state "
                    "was inconclusive."
                ),
            )
        if existing_order is not None:
            db.commit()
            if not _acquire_execution_gate(db, wait=False):
                intent = _get_intent(db, intent.id)
                return _persist_submission_block(
                    db,
                    intent,
                    ["The paper-execution gate is busy; no order was sent."],
                    warnings,
                    message="Existing paper-order recovery will retry after the active operation.",
                )
            automation = ensure_automation_settings(db, lock=True)
            intent = _get_intent(db, intent.id, lock=True)
            existing_order = await _expand_protected_order(broker, existing_order)
            _record_broker_order(db, intent, existing_order)
            _engage_kill_for_protection_failure(
                db,
                intent,
                automation,
                broker_order_id=existing_order.id,
            )
            _audit(
                db,
                action="order_recovered",
                entity_type="execution_intent",
                entity_id=intent.id,
                outcome=intent.status,
                message=(
                    "Recovered an existing Alpaca paper order by deterministic "
                    "client order ID."
                ),
                details={"broker_order_id": existing_order.id},
            )
            db.commit()
            db.refresh(intent)
            return AutomationDecision(intent, warnings=tuple(warnings))

        if market_provider is None:
            market_provider = AlpacaMarketDataProvider(
                app_settings.alpaca_api_key_id,
                app_settings.alpaca_api_secret_key,
                feed=app_settings.alpaca_execution_feed,
                base_url=app_settings.alpaca_data_base_url,
            )

        account = await broker.get_account()
        clock = await broker.get_clock()
        positions = await broker.list_positions()
        orders = await broker.list_orders(
            status="open",
            limit=100,
            nested=True,
            symbols=[plan.ticker],
        )
        notional = intent.limit_price * Decimal(intent.quantity)
        if account.status.upper() != "ACTIVE":
            blockers.append(f"Broker account status is {account.status}, not ACTIVE.")
        if account.account_blocked or account.trading_blocked or account.trade_suspended_by_user:
            blockers.append("The broker account is blocked or trading-suspended.")
        if account.buying_power is None:
            blockers.append("Broker buying power is unavailable; submission fails closed.")
        elif account.buying_power < notional:
            blockers.append("Broker buying power is below the planned order notional.")
        if not clock.is_open:
            blockers.append("The U.S. equity market is currently closed.")

        broker_now = _aware(clock.timestamp).astimezone(NEW_YORK)
        trading_date = broker_now.date()
        trading_time = broker_now.time().replace(tzinfo=None)
        risk_settings = ensure_risk_settings(db)
        if plan.plan_date != trading_date:
            blockers.append(
                "Only a trade plan dated for the broker's current trading day can be submitted."
            )
        if not (risk_settings.allowed_start_time <= trading_time <= risk_settings.allowed_end_time):
            blockers.append(
                "Broker time is outside the configured trading window "
                f"({risk_settings.allowed_start_time.strftime('%H:%M')}–"
                f"{risk_settings.allowed_end_time.strftime('%H:%M')} America/New_York)."
            )
        if _daily_submission_count(db, trading_date) >= automation.max_orders_per_day:
            blockers.append("The paper-automation daily order limit has been reached.")
        if any(
            position.symbol == plan.ticker and position.quantity != 0
            for position in positions.positions
        ):
            blockers.append(f"A broker position already exists for {plan.ticker}.")
        if any(order.client_order_id != intent.client_order_id for order in orders.orders):
            blockers.append(f"Another open broker order already exists for {plan.ticker}.")

        capabilities = market_provider.capabilities
        if not capabilities.real_time or (capabilities.delay_seconds or 0) > 0:
            blockers.append(
                "Execution requires a provider-declared real-time quote; delayed data is rejected."
            )
        if capabilities.feed != app_settings.alpaca_execution_feed:
            blockers.append(
                f"Execution provider feed {capabilities.feed!r} does not match the configured "
                f"{app_settings.alpaca_execution_feed!r} feed."
            )
        if not blockers:
            batch = await market_provider.get_snapshots(
                [plan.ticker],
                feed=app_settings.alpaca_execution_feed,
            )
            snapshot = next(
                (item for item in batch.snapshots if item.symbol == plan.ticker),
                None,
            )
            if snapshot is None:
                blockers.append(
                    "The execution provider returned no current snapshot for this ticker."
                )
            else:
                quote_snapshot, quote_blockers = _snapshot_quote(
                    snapshot,
                    intent=intent,
                    automation=automation,
                    risk_settings=risk_settings,
                    expected_feed=app_settings.alpaca_execution_feed,
                )
                intent.quote_snapshot = quote_snapshot
                blockers.extend(quote_blockers)

        if blockers:
            return _persist_submission_block(
                db,
                intent,
                blockers,
                warnings,
                message="Paper order submission was blocked by broker or market checks.",
            )

        # Persist slow-preflight evidence, then take the shared execution gate.
        # Kill-switch updates and every submission lock this same singleton row.
        db.commit()
        if not _acquire_execution_gate(db, wait=False):
            intent = _get_intent(db, intent.id)
            return _persist_submission_block(
                db,
                intent,
                ["The paper-execution gate is busy; no order was sent."],
                warnings,
                message="Paper order submission deferred because another guarded operation is active.",
            )
        automation = ensure_automation_settings(db, lock=True)
        intent = _get_intent(db, intent.id, lock=True)
        plan = _get_plan(db, intent.trade_plan_id)
        if intent.status != "approved":
            db.commit()
            return AutomationDecision(
                intent,
                blockers=(
                    "This intent changed state while its submission was being checked.",
                ),
            )

        final_blockers, final_warnings = _local_preflight(
            db,
            intent,
            plan,
            automation,
            app_settings,
        )
        final_blockers.extend(
            blocker
            for blocker in _quote_snapshot_blockers(intent, automation, app_settings)
            if blocker not in final_blockers
        )
        if _daily_submission_count(db, trading_date) >= automation.max_orders_per_day:
            final_blockers.append("The paper-automation daily order limit has been reached.")
        if final_blockers:
            return _persist_submission_block(
                db,
                intent,
                final_blockers,
                final_warnings,
                message="Paper order submission was blocked at the final execution gate.",
            )

        # Repeat the deterministic lookup immediately before POST. Any result
        # other than a conclusive 404 blocks a new dispatch.
        try:
            existing_order = await broker.get_order_by_client_id(intent.client_order_id)
        except BrokerNotFoundError:
            existing_order = None
        except BrokerProviderError as exc:
            return _persist_submission_block(
                db,
                intent,
                [f"Final broker idempotency lookup failed; no order was sent: {exc}"],
                final_warnings,
                message="Paper order submission stopped at the final idempotency check.",
            )
        if existing_order is not None:
            existing_order = await _expand_protected_order(broker, existing_order)
            _record_broker_order(db, intent, existing_order)
            _engage_kill_for_protection_failure(
                db,
                intent,
                automation,
                broker_order_id=existing_order.id,
            )
            _audit(
                db,
                action="order_recovered",
                entity_type="execution_intent",
                entity_id=intent.id,
                outcome=intent.status,
                message=(
                    "Recovered an existing Alpaca paper order at the final "
                    "idempotency check."
                ),
                details={"broker_order_id": existing_order.id},
            )
            db.commit()
            db.refresh(intent)
            return AutomationDecision(intent, warnings=tuple(final_warnings))

        request = _order_request(intent, plan)
        intent.request_payload = jsonable_encoder(asdict(request))
        intent.status = "submitting"
        intent.submitted_at = intent.submitted_at or _now()
        _audit(
            db,
            action="submission_started",
            entity_type="execution_intent",
            entity_id=intent.id,
            outcome="pending",
            message=(
                "Submitting one idempotent protected limit order to Alpaca paper trading."
            ),
            details={
                "client_order_id": intent.client_order_id,
                "request": intent.request_payload,
            },
        )
        # Do not commit here: the global gate remains locked through dispatch.
        db.flush()

        try:
            dispatch_started = True
            order = await broker.submit_order(request)
        except BrokerOrderRejectedError as exc:
            if exc.status_code != 409:
                intent.status = "rejected"
                intent.failure_reason = str(exc)
                _audit(
                    db,
                    action="order_submission",
                    entity_type="execution_intent",
                    entity_id=intent.id,
                    outcome="rejected",
                    message="Alpaca explicitly rejected the paper order.",
                    details={"reason": str(exc)},
                )
                db.commit()
                db.refresh(intent)
                return AutomationDecision(
                    intent,
                    blockers=(str(exc),),
                    warnings=tuple(final_warnings),
                )
            try:
                order = await broker.get_order_by_client_id(intent.client_order_id)
            except BrokerProviderError as lookup_exc:
                return _persist_submission_unknown(
                    db,
                    intent,
                    f"duplicate response: {exc}; lookup inconclusive: {lookup_exc}",
                )
        except (
            BrokerProviderError,
            ProviderPayloadError,
            httpx.HTTPError,
            ValueError,
            TypeError,
        ) as exc:
            try:
                order = await broker.get_order_by_client_id(intent.client_order_id)
            except BrokerProviderError as lookup_exc:
                return _persist_submission_unknown(
                    db,
                    intent,
                    f"dispatch error: {exc}; lookup inconclusive: {lookup_exc}",
                )
        except Exception as exc:
            try:
                order = await broker.get_order_by_client_id(intent.client_order_id)
            except BrokerProviderError as lookup_exc:
                return _persist_submission_unknown(
                    db,
                    intent,
                    f"unexpected dispatch error: {exc}; lookup inconclusive: {lookup_exc}",
                )

        order = await _expand_protected_order(broker, order)
        _record_broker_order(db, intent, order)
        _engage_kill_for_protection_failure(
            db,
            intent,
            automation,
            broker_order_id=order.id,
        )
        _audit(
            db,
            action="order_submitted",
            entity_type="execution_intent",
            entity_id=intent.id,
            outcome=intent.status,
            message="Alpaca paper order accepted and recorded.",
            details={
                "broker_order_id": order.id,
                "client_order_id": order.client_order_id,
            },
        )
        db.commit()
        db.refresh(intent)
        return AutomationDecision(intent, warnings=tuple(final_warnings))
    except (BrokerNotConfigured, UnsafeBrokerConfiguration) as exc:
        db.rollback()
        intent = _get_intent(db, intent_id)
        return _persist_submission_block(
            db,
            intent,
            [str(exc)],
            warnings,
            message="Paper order submission was blocked by unsafe broker configuration.",
        )
    except (
        BrokerProviderError,
        ProviderPayloadError,
        httpx.HTTPError,
        ValueError,
        TypeError,
    ) as exc:
        db.rollback()
        intent = _get_intent(db, intent_id)
        if dispatch_started:
            return _persist_submission_unknown(db, intent, str(exc))
        return _persist_submission_block(
            db,
            intent,
            [f"Provider preflight failed; no order was sent: {exc}"],
            warnings,
            message=(
                "Paper order submission stopped on a transient provider "
                "preflight failure."
            ),
        )
    finally:
        if own_market and market_provider is not None:
            await _safe_close(market_provider, label="market data")
        if own_broker and broker is not None:
            await _safe_close(broker, label="broker")


async def reconcile_execution_intents(
    db: Session,
    app_settings: Settings,
    *,
    broker: Optional[BrokerProvider] = None,
) -> tuple[int, int]:
    ensure_automation_settings(db, app_settings)
    intent_ids = [
        row[0]
        for row in db.query(ExecutionIntent.id)
        .filter(ExecutionIntent.status.in_(RECONCILABLE_INTENT_STATUSES))
        .order_by(ExecutionIntent.id)
        .all()
    ]
    db.commit()
    if not intent_ids:
        return 0, 0

    own_broker = broker is None
    reconciled = 0
    failed = 0
    try:
        if broker is None:
            broker = create_broker(app_settings)
        if not broker.paper_trading:
            raise UnsafeBrokerConfiguration(
                "Reconciliation is restricted to the paper broker."
            )

        for intent_id in intent_ids:
            # Match the global-lock -> intent-lock ordering used by dispatch.
            if not _acquire_execution_gate(db, wait=False):
                db.rollback()
                continue
            automation = ensure_automation_settings(db, lock=True)
            intent = _get_intent(db, intent_id, lock=True)
            if intent.status not in RECONCILABLE_INTENT_STATUSES:
                db.commit()
                continue
            try:
                order = await broker.get_order_by_client_id(intent.client_order_id)
            except BrokerNotFoundError:
                intent.last_reconciled_at = _now()
                if intent.status == "submitting":
                    intent.status = "submission_unknown"
                    intent.failure_reason = (
                        "The worker found no broker order for an interrupted submission. "
                        "It remains non-retryable until an operator resolves it."
                    )
                _audit(
                    db,
                    action="order_reconciliation",
                    entity_type="execution_intent",
                    entity_id=intent.id,
                    outcome="not_found",
                    message=(
                        "No Alpaca order was found for the deterministic client order ID; "
                        "the intent was not retried."
                    ),
                    details={"client_order_id": intent.client_order_id},
                )
                failed += 1
                db.commit()
                continue
            except BrokerProviderError as exc:
                intent.last_reconciled_at = _now()
                _audit(
                    db,
                    action="order_reconciliation",
                    entity_type="execution_intent",
                    entity_id=intent.id,
                    outcome="failed",
                    message="Paper order reconciliation failed.",
                    details={"reason": str(exc)},
                )
                failed += 1
                db.commit()
                continue

            order = await _expand_protected_order(broker, order)
            _record_broker_order(db, intent, order)
            _engage_kill_for_protection_failure(
                db,
                intent,
                automation,
                broker_order_id=order.id,
            )
            _audit(
                db,
                action="order_reconciled",
                entity_type="execution_intent",
                entity_id=intent.id,
                outcome=intent.status,
                message=(
                    "Local execution state reconciled from Alpaca by deterministic "
                    "client order ID."
                ),
                details={
                    "broker_order_id": order.id,
                    "broker_status": order.status,
                },
            )
            db.commit()
            reconciled += 1
        return reconciled, failed
    finally:
        if own_broker and broker is not None:
            await _safe_close(broker, label="broker")


async def run_automation_once(
    db: Session,
    app_settings: Settings,
    *,
    broker: Optional[BrokerProvider] = None,
    market_provider: Optional[MarketDataProvider] = None,
) -> AutomationRunStats:
    own_broker = broker is None
    own_market = market_provider is None
    processed = submitted = failed = 0
    try:
        if app_settings.allow_live_trading or not app_settings.alpaca_paper_mode:
            raise UnsafeBrokerConfiguration(
                "Automation is hard-blocked unless Alpaca uses the exact paper endpoint "
                "and live trading is disabled."
            )
        if broker is None and app_settings.alpaca_configured and app_settings.alpaca_paper_mode:
            broker = create_broker(app_settings)
        reconciled = reconciliation_failures = 0
        if broker is not None:
            reconciled, reconciliation_failures = await reconcile_execution_intents(
                db, app_settings, broker=broker
            )
        failed += reconciliation_failures

        automation = ensure_automation_settings(db, app_settings)
        if (
            broker is None
            or not automation.enabled
            or not automation.auto_submit_approved
            or automation.kill_switch_engaged
        ):
            return AutomationRunStats(0, 0, reconciled, failed)
        if market_provider is None:
            market_provider = AlpacaMarketDataProvider(
                app_settings.alpaca_api_key_id,
                app_settings.alpaca_api_secret_key,
                feed=app_settings.alpaca_execution_feed,
                base_url=app_settings.alpaca_data_base_url,
            )

        approved = (
            db.query(ExecutionIntent)
            .filter(ExecutionIntent.status == "approved")
            .order_by(ExecutionIntent.id)
            .all()
        )
        for intent in approved:
            processed += 1
            decision = await submit_execution_intent(
                db,
                intent.id,
                app_settings,
                broker=broker,
                market_provider=market_provider,
            )
            if decision.intent.status in {
                "submitted",
                "partially_filled",
                "entry_filled_protected",
                "filled",
            }:
                submitted += 1
            elif decision.blockers:
                failed += 1
        return AutomationRunStats(processed, submitted, reconciled, failed)
    finally:
        if own_market and market_provider is not None:
            await _safe_close(market_provider, label="market data")
        if own_broker and broker is not None:
            await _safe_close(broker, label="broker")
