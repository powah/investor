import asyncio
from dataclasses import asdict
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.encoders import jsonable_encoder

from app.core.config import Settings
from app.core.database import Base
from app.models.integrations import BrokerStreamState, BrokerTradeUpdate as StoredTradeUpdate, ExecutionIntent
from app.providers.broker import BrokerOrder, BrokerOrderList, BrokerTradeUpdate
from app.services.automation import ensure_automation_settings
from app.services.order_stream import ingest_and_process_trade_update, process_pending_trade_updates


NOW = datetime(2026, 7, 12, 10, 0, tzinfo=timezone.utc)


def _order(status="accepted"):
    return BrokerOrder(
        id="order-1",
        client_order_id="plan-1-entry-v1",
        symbol="AAPL",
        side="buy",
        order_type="limit",
        time_in_force="day",
        order_class="simple",
        status=status,
        quantity=Decimal("2"),
        notional=None,
        filled_quantity=Decimal("1") if status == "partially_filled" else Decimal("0"),
        filled_average_price=Decimal("190") if status == "partially_filled" else None,
        limit_price=Decimal("191"),
        stop_price=None,
        created_at=NOW,
        submitted_at=NOW,
        updated_at=NOW,
        filled_at=None,
        canceled_at=None,
        expired_at=None,
        failed_at=None,
        replaces=None,
        replaced_by=None,
    )


class FakeBroker:
    provider_name = "alpaca"
    paper_trading = True

    async def get_order(self, order_id, *, nested=True):
        return _order()

    async def list_orders(self, **kwargs):
        return BrokerOrderList(orders=())

    async def aclose(self):
        return None


def test_durable_inbox_deduplicates_replays_and_applies_intent_state():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(engine)
    settings = Settings(_env_file=None, database_url="sqlite+pysqlite:///:memory:")

    with Session() as db:
        ensure_automation_settings(db, settings)
        db.add(
            ExecutionIntent(
                trade_plan_id=1,
                status="submitted",
                quantity=2,
                limit_price=Decimal("191"),
                stop_price=Decimal("185"),
                client_order_id="plan-1-entry-v1",
            )
        )
        db.commit()

        order = _order("partially_filled")
        update = BrokerTradeUpdate(
            provider="alpaca",
            provider_event_id="alpaca:execution:fill-1:partial_fill",
            stream="trade_updates",
            event_type="partial_fill",
            order=order,
            occurred_at=NOW,
            received_at=NOW,
            execution_id="fill-1",
            raw_data={"stream": "trade_updates", "data": {"event": "partial_fill"}},
        )

        first, first_duplicate = asyncio.run(ingest_and_process_trade_update(db, update, FakeBroker()))
        replay, replay_duplicate = asyncio.run(ingest_and_process_trade_update(db, update, FakeBroker()))

        intent = db.query(ExecutionIntent).one()
        state = db.get(BrokerStreamState, "alpaca")
        assert first.id == replay.id
        assert first_duplicate is False
        assert replay_duplicate is True
        assert intent.status == "partially_filled"
        assert db.query(StoredTradeUpdate).count() == 1
        assert state.events_received == 1
        assert state.events_processed == 1
        assert state.duplicate_events == 1
        assert replay.processed_at is not None


def test_restart_recovery_applies_an_event_committed_before_processing():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(engine)

    with Session() as db:
        ensure_automation_settings(
            db,
            Settings(_env_file=None, database_url="sqlite+pysqlite:///:memory:"),
        )
        db.add(
            ExecutionIntent(
                trade_plan_id=1,
                status="submitted",
                quantity=2,
                limit_price=Decimal("191"),
                stop_price=Decimal("185"),
                client_order_id="plan-1-entry-v1",
            )
        )
        order = _order("partially_filled")
        db.add(
            StoredTradeUpdate(
                provider="alpaca",
                provider_event_id="alpaca:execution:crash-window:partial_fill",
                stream="trade_updates",
                event_type="partial_fill",
                broker_order_id=order.id,
                client_order_id=order.client_order_id,
                execution_id="crash-window",
                occurred_at=NOW,
                received_at=NOW,
                raw_data={"stream": "trade_updates"},
                normalized_order=jsonable_encoder(asdict(order)),
            )
        )
        db.commit()

        processed, failed = asyncio.run(process_pending_trade_updates(db, FakeBroker()))

        stored = db.query(StoredTradeUpdate).one()
        intent = db.query(ExecutionIntent).one()
        assert (processed, failed) == (1, 0)
        assert stored.processed_at is not None
        assert stored.execution_intent_id == intent.id
        assert intent.status == "partially_filled"
