"""Durable trade-update inbox, recovery, and execution-state application."""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import logging
from typing import Any, Mapping, Optional

from fastapi.encoders import jsonable_encoder
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.integrations import (
    AutomationAuditLog,
    BrokerStreamState,
    BrokerTradeUpdate as StoredTradeUpdate,
    ExecutionIntent,
)
from app.providers.broker import BrokerOrder, BrokerProvider, BrokerTradeUpdate
from app.services.automation import (
    apply_broker_order_state,
    engage_kill_for_protection_failure,
    ensure_automation_settings,
    expand_protected_order,
)


logger = logging.getLogger(__name__)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def ensure_stream_state(db: Session, *, lock: bool = False) -> BrokerStreamState:
    query = db.query(BrokerStreamState).filter(BrokerStreamState.provider == "alpaca")
    if lock:
        query = query.with_for_update()
    state = query.first()
    if state is None:
        state = BrokerStreamState(provider="alpaca", environment="paper", status="disabled")
        db.add(state)
        db.flush()
    return state


def set_stream_status(
    db: Session,
    status: str,
    *,
    error: Optional[str] = None,
    connected: bool = False,
    disconnected: bool = False,
    reconnect: bool = False,
) -> BrokerStreamState:
    state = ensure_stream_state(db, lock=True)
    now = utc_now()
    state.status = status
    state.last_error = error
    if connected:
        state.last_connected_at = now
    if disconnected:
        state.last_disconnected_at = now
    if reconnect:
        state.reconnect_count += 1
    db.commit()
    db.refresh(state)
    return state


async def ingest_and_process_trade_update(
    db: Session,
    update: BrokerTradeUpdate,
    broker: BrokerProvider,
) -> tuple[StoredTradeUpdate, bool]:
    """Commit source data first, then apply it in a restart-safe transaction.

    Returns ``(stored_event, duplicate)``. A replay of an unprocessed event is
    still processed; a replay of an already processed event is a no-op.
    """

    stored = (
        db.query(StoredTradeUpdate)
        .filter(
            StoredTradeUpdate.provider == update.provider,
            StoredTradeUpdate.provider_event_id == update.provider_event_id,
        )
        .first()
    )
    duplicate = stored is not None
    if stored is None:
        stored = StoredTradeUpdate(
            provider=update.provider,
            provider_event_id=update.provider_event_id,
            stream=update.stream,
            event_type=update.event_type,
            broker_order_id=update.order.id,
            client_order_id=update.order.client_order_id,
            execution_id=update.execution_id,
            price=update.price,
            quantity=update.quantity,
            position_quantity=update.position_quantity,
            occurred_at=update.occurred_at,
            received_at=update.received_at,
            raw_data=jsonable_encoder(update.raw_data or {}),
            normalized_order=jsonable_encoder(asdict(update.order)),
        )
        db.add(stored)
        state = ensure_stream_state(db, lock=True)
        state.events_received += 1
        state.last_event_at = update.occurred_at
        try:
            db.commit()
        except IntegrityError:
            # Another worker transaction won the unique-key race. This should
            # not normally occur because only one worker owns the connection,
            # but the database remains the final deduplication authority.
            db.rollback()
            stored = (
                db.query(StoredTradeUpdate)
                .filter(
                    StoredTradeUpdate.provider == update.provider,
                    StoredTradeUpdate.provider_event_id == update.provider_event_id,
                )
                .one()
            )
            duplicate = True

    if duplicate:
        state = ensure_stream_state(db, lock=True)
        state.duplicate_events += 1
        db.commit()
    if stored.processed_at is None:
        await process_stored_trade_update(db, stored.id, broker)
        stored = db.get(StoredTradeUpdate, stored.id)
        assert stored is not None
    return stored, duplicate


async def process_stored_trade_update(
    db: Session,
    event_id: int,
    broker: BrokerProvider,
) -> bool:
    stored = db.get(StoredTradeUpdate, event_id)
    if stored is None or stored.processed_at is not None:
        return False
    try:
        order = _order_from_snapshot(stored.normalized_order)
        order = await expand_protected_order(broker, order)
        stored = (
            db.query(StoredTradeUpdate)
            .filter(StoredTradeUpdate.id == event_id)
            .with_for_update()
            .one()
        )
        if stored.processed_at is not None:
            db.rollback()
            return False
        intent = (
            db.query(ExecutionIntent)
            .filter(
                or_(
                    ExecutionIntent.client_order_id == stored.client_order_id,
                    ExecutionIntent.broker_order_id == stored.broker_order_id,
                )
            )
            .with_for_update()
            .first()
        )
        if intent is not None:
            automation = ensure_automation_settings(db, lock=True)
            apply_broker_order_state(db, intent, order)
            engage_kill_for_protection_failure(
                db,
                intent,
                automation,
                broker_order_id=order.id,
            )
            stored.execution_intent_id = intent.id
            db.add(
                AutomationAuditLog(
                    action="trade_update_applied",
                    entity_type="execution_intent",
                    entity_id=intent.id,
                    outcome=intent.status,
                    message="A durable Alpaca trade update was applied to local execution state.",
                    details={
                        "provider_event_id": stored.provider_event_id,
                        "event_type": stored.event_type,
                        "broker_order_id": stored.broker_order_id,
                    },
                )
            )
        stored.processed_at = utc_now()
        stored.processing_error = None
        state = ensure_stream_state(db, lock=True)
        state.events_processed += 1
        db.commit()
        return True
    except Exception as exc:
        db.rollback()
        failed = db.get(StoredTradeUpdate, event_id)
        if failed is not None:
            failed.processing_error = str(exc)[:2000]
            db.commit()
        raise


async def process_pending_trade_updates(
    db: Session,
    broker: BrokerProvider,
    *,
    limit: int = 500,
) -> tuple[int, int]:
    event_ids = [
        row[0]
        for row in db.query(StoredTradeUpdate.id)
        .filter(StoredTradeUpdate.processed_at.is_(None))
        .order_by(StoredTradeUpdate.id)
        .limit(limit)
        .all()
    ]
    processed = failed = 0
    for event_id in event_ids:
        try:
            if await process_stored_trade_update(db, event_id, broker):
                processed += 1
        except Exception:
            failed += 1
            logger.exception("Could not apply durable broker event id=%s", event_id)
    return processed, failed


async def backfill_broker_orders(db: Session, broker: BrokerProvider) -> tuple[int, int]:
    """Backfill the newest 500 paper orders and deduplicate their snapshots."""

    result = await broker.list_orders(status="all", limit=500, nested=True, direction="desc")
    inserted = duplicates = 0
    # Apply oldest to newest within this recovery page.
    for order in reversed(result.orders):
        update = trade_update_from_rest_order(order)
        _, duplicate = await ingest_and_process_trade_update(db, update, broker)
        inserted += int(not duplicate)
        duplicates += int(duplicate)
    state = ensure_stream_state(db, lock=True)
    state.last_backfill_at = utc_now()
    db.commit()
    return inserted, duplicates


def trade_update_from_rest_order(order: BrokerOrder) -> BrokerTradeUpdate:
    snapshot = jsonable_encoder(asdict(order))
    canonical = json.dumps(snapshot, sort_keys=True, separators=(",", ":"))
    fingerprint = hashlib.sha256(canonical.encode()).hexdigest()[:32]
    occurred_at = order.updated_at or order.submitted_at or order.created_at or utc_now()
    return BrokerTradeUpdate(
        provider="alpaca",
        provider_event_id=f"alpaca:rest:{order.id}:{fingerprint}",
        stream="rest_backfill",
        event_type="rest_backfill",
        order=order,
        occurred_at=occurred_at,
        received_at=utc_now(),
        raw_data={"source": "rest_backfill", "order": snapshot},
    )


def _order_from_snapshot(payload: Mapping[str, Any]) -> BrokerOrder:
    def decimal(name: str, *, required: bool = False) -> Optional[Decimal]:
        value = payload.get(name)
        if value is None or value == "":
            if required:
                raise ValueError(f"Stored broker order is missing {name}.")
            return None
        return Decimal(str(value))

    def timestamp(name: str) -> Optional[datetime]:
        value = payload.get(name)
        if not value:
            return None
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed

    legs_payload = payload.get("legs") or []
    if not isinstance(legs_payload, list):
        raise ValueError("Stored broker order legs must be an array.")
    return BrokerOrder(
        id=str(payload["id"]),
        client_order_id=str(payload["client_order_id"]),
        symbol=str(payload.get("symbol") or ""),
        side=str(payload.get("side") or ""),
        order_type=str(payload["order_type"]),
        time_in_force=str(payload["time_in_force"]),
        order_class=str(payload["order_class"]),
        status=str(payload["status"]),
        quantity=decimal("quantity"),
        notional=decimal("notional"),
        filled_quantity=decimal("filled_quantity", required=True) or Decimal("0"),
        filled_average_price=decimal("filled_average_price"),
        limit_price=decimal("limit_price"),
        stop_price=decimal("stop_price"),
        created_at=timestamp("created_at"),
        submitted_at=timestamp("submitted_at"),
        updated_at=timestamp("updated_at"),
        filled_at=timestamp("filled_at"),
        canceled_at=timestamp("canceled_at"),
        expired_at=timestamp("expired_at"),
        failed_at=timestamp("failed_at"),
        replaces=str(payload["replaces"]) if payload.get("replaces") else None,
        replaced_by=str(payload["replaced_by"]) if payload.get("replaced_by") else None,
        legs=tuple(_order_from_snapshot(item) for item in legs_payload),
        request_id=str(payload["request_id"]) if payload.get("request_id") else None,
    )
