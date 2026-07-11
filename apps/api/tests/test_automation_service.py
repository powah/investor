from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.core.database import Base
from app.models.integrations import (
    AutomationAuditLog,
    AutomationSettings,
    BrokerOrderEvent,
    ExecutionIntent,
)
from app.models.trading import TradePlan
from app.providers.broker import (
    BrokerAccount,
    BrokerClock,
    BrokerNotFoundError,
    BrokerOrder,
    BrokerOrderList,
    BrokerPayloadError,
    BrokerPositionList,
    BrokerRequestError,
    BrokerTransportError,
)
from app.providers.contracts import (
    MarketBar,
    MarketDataCapabilities,
    MarketQuote,
    MarketSnapshot,
    MarketSnapshotBatch,
    Provenance,
)
from app.services.automation import (
    approve_execution_intent,
    create_execution_intent,
    ensure_automation_settings,
    reconcile_execution_intents,
    submit_execution_intent,
    update_automation_settings,
    update_kill_switch,
)


NEW_YORK = ZoneInfo("America/New_York")
TRADING_DATE = datetime.now(timezone.utc).astimezone(NEW_YORK).date()


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
    with Session(engine) as session:
        yield session


def _plan(db: Session, *, warnings=None, target_price=11.0) -> TradePlan:
    plan = TradePlan(
        plan_date=TRADING_DATE,
        ticker="TEST",
        account_size=10_000,
        max_risk_per_trade_pct=0.5,
        entry_price=10.0,
        stop_price=9.5,
        target_price=target_price,
        risk_per_share=0.5,
        shares=100,
        max_loss=50.0,
        r_multiple=2.0 if target_price is not None else None,
        warnings=warnings or [],
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


def _app_settings() -> Settings:
    return Settings(
        alpaca_api_key_id="paper-key",
        alpaca_api_secret_key="paper-secret",
        alpaca_trading_base_url="https://paper-api.alpaca.markets",
        alpaca_data_base_url="https://data.alpaca.markets",
        alpaca_execution_feed="iex",
        allow_live_trading=False,
    )


def _account() -> BrokerAccount:
    return BrokerAccount(
        id="paper-account",
        status="ACTIVE",
        account_number="PA123",
        currency="USD",
        cash=Decimal("10000"),
        equity=Decimal("10000"),
        buying_power=Decimal("20000"),
        non_marginable_buying_power=Decimal("10000"),
        portfolio_value=Decimal("10000"),
        multiplier=Decimal("2"),
        shorting_enabled=False,
        account_blocked=False,
        trading_blocked=False,
        trade_suspended_by_user=False,
        created_at=None,
    )


def _clock() -> BrokerClock:
    now = datetime.combine(TRADING_DATE, time(10, 0), NEW_YORK).astimezone(timezone.utc)
    return BrokerClock(
        timestamp=now,
        is_open=True,
        next_open=now + timedelta(days=1),
        next_close=now + timedelta(hours=6),
    )


def _accepted_order(request) -> BrokerOrder:
    now = datetime.now(timezone.utc)
    return BrokerOrder(
        id="broker-order-1",
        client_order_id=request.client_order_id,
        symbol=request.symbol,
        side=request.side,
        order_type="limit",
        time_in_force=request.time_in_force,
        order_class=request.order_class,
        status="accepted",
        quantity=request.quantity,
        notional=None,
        filled_quantity=Decimal("0"),
        filled_average_price=None,
        limit_price=request.limit_price,
        stop_price=None,
        created_at=now,
        submitted_at=now,
        updated_at=now,
        filled_at=None,
        canceled_at=None,
        expired_at=None,
        failed_at=None,
        replaces=None,
        replaced_by=None,
    )


def _broker_order(
    *,
    client_order_id: str,
    status: str = "accepted",
    order_id: str = "broker-order-1",
    side: str = "buy",
    order_type: str = "limit",
    order_class: str = "bracket",
    quantity: Decimal = Decimal("100"),
    filled_quantity: Decimal = Decimal("0"),
    limit_price: Decimal | None = Decimal("10"),
    stop_price: Decimal | None = None,
    legs: tuple[BrokerOrder, ...] = (),
) -> BrokerOrder:
    now = datetime.now(timezone.utc)
    return BrokerOrder(
        id=order_id,
        client_order_id=client_order_id,
        symbol="TEST",
        side=side,
        order_type=order_type,
        time_in_force="day",
        order_class=order_class,
        status=status,
        quantity=quantity,
        notional=None,
        filled_quantity=filled_quantity,
        filled_average_price=Decimal("10") if filled_quantity else None,
        limit_price=limit_price,
        stop_price=stop_price,
        created_at=now,
        submitted_at=now,
        updated_at=now,
        filled_at=now if status == "filled" else None,
        canceled_at=None,
        expired_at=None,
        failed_at=None,
        replaces=None,
        replaced_by=None,
        legs=legs,
    )


class FakeBroker:
    provider_name = "alpaca"
    paper_trading = True

    def __init__(self, *, ambiguous=False, lookup_order=None):
        self.ambiguous = ambiguous
        self.lookup_order = lookup_order
        self.submit_calls = 0
        self.lookup_calls = 0
        self.last_request = None

    async def get_account(self):
        return _account()

    async def get_clock(self):
        return _clock()

    async def list_positions(self):
        return BrokerPositionList(positions=())

    async def list_orders(self, **kwargs):
        return BrokerOrderList(orders=())

    async def submit_order(self, request):
        self.submit_calls += 1
        self.last_request = request
        if self.ambiguous:
            raise BrokerTransportError("connection ended during submit", outcome_unknown=True)
        return _accepted_order(request)

    async def get_order_by_client_id(self, client_order_id):
        self.lookup_calls += 1
        if self.lookup_order is None or self.submit_calls == 0:
            raise BrokerNotFoundError("order not found")
        return self.lookup_order(self.last_request)

    async def cancel_order(self, order_id):
        raise AssertionError("cancel_order is not expected in these tests")

    async def aclose(self):
        return None


class StaticLookupBroker(FakeBroker):
    def __init__(self, order: BrokerOrder):
        super().__init__()
        self.order = order
        self.lookup_client_ids: list[str] = []

    async def get_order_by_client_id(self, client_order_id):
        self.lookup_calls += 1
        self.lookup_client_ids.append(client_order_id)
        return self.order


class NestedOrderBroker(StaticLookupBroker):
    def __init__(self, order: BrokerOrder, nested_order: BrokerOrder):
        super().__init__(order)
        self.nested_order = nested_order
        self.nested_calls: list[tuple[str, bool]] = []

    async def get_order(self, order_id: str, *, nested: bool = True):
        self.nested_calls.append((order_id, nested))
        return self.nested_order


class LookupFailureBroker(FakeBroker):
    async def get_order_by_client_id(self, client_order_id):
        self.lookup_calls += 1
        raise BrokerRequestError("broker lookup unavailable", status_code=503)


class PostDispatchFailureBroker(FakeBroker):
    def __init__(self, failure: Exception):
        super().__init__()
        self.failure = failure

    async def submit_order(self, request):
        self.submit_calls += 1
        self.last_request = request
        raise self.failure

    async def get_order_by_client_id(self, client_order_id):
        self.lookup_calls += 1
        if self.submit_calls == 0:
            raise BrokerNotFoundError("order not found")
        raise BrokerRequestError("post-dispatch lookup unavailable", status_code=503)


class FakeMarketProvider:
    capabilities = MarketDataCapabilities(
        provider="alpaca",
        feed="iex",
        real_time=True,
        delay_seconds=0,
        is_consolidated=False,
        coverage="iex_single_venue",
        history_start=None,
    )

    def __init__(self):
        self.calls = 0

    async def get_snapshots(self, symbols, *, feed=None):
        self.calls += 1
        now = datetime.now(timezone.utc)
        provenance = Provenance(
            provider="alpaca",
            observed_at=now,
            source_feed=feed or "iex",
            delay_seconds=0,
            is_consolidated=False,
        )
        snapshot = MarketSnapshot(
            symbol="TEST",
            provenance=provenance,
            latest_trade=None,
            latest_quote=MarketQuote(
                bid_price=9.99,
                bid_size=100,
                ask_price=10.01,
                ask_size=100,
                timestamp=now,
            ),
            minute_bar=MarketBar(
                timestamp=now,
                open=9.8,
                high=10.1,
                low=9.7,
                close=10.0,
                volume=10_000,
                vwap=9.9,
            ),
            daily_bar=None,
            previous_daily_bar=None,
        )
        return MarketSnapshotBatch(snapshots=(snapshot,), provenance=provenance)


class MissingBuyingPowerBroker(FakeBroker):
    async def get_account(self):
        return replace(_account(), buying_power=None)


class OutsideTradingWindowBroker(FakeBroker):
    async def get_clock(self):
        now = datetime.combine(TRADING_DATE, time(8, 0), NEW_YORK).astimezone(timezone.utc)
        return BrokerClock(
            timestamp=now,
            is_open=True,
            next_open=now + timedelta(days=1),
            next_close=now + timedelta(hours=8),
        )


class DelayedMarketProvider(FakeMarketProvider):
    capabilities = replace(
        FakeMarketProvider.capabilities,
        feed="delayed_sip",
        real_time=False,
        delay_seconds=900,
        is_consolidated=True,
    )


class FutureDatedMarketProvider(FakeMarketProvider):
    async def get_snapshots(self, symbols, *, feed=None):
        batch = await super().get_snapshots(symbols, feed=feed)
        snapshot = batch.snapshots[0]
        future_quote = replace(
            snapshot.latest_quote,
            timestamp=datetime.now(timezone.utc) + timedelta(minutes=1),
        )
        return replace(
            batch,
            snapshots=(replace(snapshot, latest_quote=future_quote),),
        )


def _enable_paper_automation(db: Session):
    update_automation_settings(db, {"enabled": True})
    update_kill_switch(
        db,
        engaged=False,
        confirmation="ARM PAPER AUTOMATION",
    )


def _approved_intent(db: Session, plan: TradePlan) -> ExecutionIntent:
    created = create_execution_intent(db, plan.id)
    assert created.blockers == ()
    approved = approve_execution_intent(
        db,
        created.intent.id,
        acknowledge_warnings=True,
        approval_note="Reviewed for paper execution",
    )
    assert approved.blockers == ()
    assert approved.intent.status == "approved"
    return approved.intent


def test_automation_defaults_are_fail_closed_and_kill_switch_changes_are_audited(db: Session):
    settings = ensure_automation_settings(db)

    assert settings.enabled is False
    assert settings.auto_submit_approved is False
    assert settings.kill_switch_engaged is True
    assert settings.require_manual_approval is True
    assert settings.paper_only is True
    assert settings.allowed_order_types == ["limit"]

    with pytest.raises(ValueError, match="requires confirmation"):
        update_kill_switch(db, engaged=False)

    released = update_kill_switch(
        db,
        engaged=False,
        confirmation="ARM PAPER AUTOMATION",
    )
    released_state = released.kill_switch_engaged
    engaged = update_kill_switch(db, engaged=True)

    assert released_state is False
    assert engaged.kill_switch_engaged is True
    actions = [row.action for row in db.query(AutomationAuditLog).order_by(AutomationAuditLog.id)]
    assert actions == ["kill_switch_released", "kill_switch_engaged"]


def test_execution_intent_creation_is_deterministic_and_idempotent_per_plan(db: Session):
    plan = _plan(db)

    first = create_execution_intent(db, plan.id)
    second = create_execution_intent(db, plan.id)

    assert first.intent.id == second.intent.id
    assert first.intent.client_order_id == f"catalyst-desk-plan-{plan.id}-v1"
    assert second.warnings == ("This trade plan already has an execution review.",)
    assert db.query(ExecutionIntent).count() == 1
    audit = db.query(AutomationAuditLog).filter_by(action="intent_created").one()
    assert audit.entity_id == first.intent.id
    assert audit.details["client_order_id"] == first.intent.client_order_id


def test_trade_plan_warnings_must_be_acknowledged_before_approval(db: Session):
    plan = _plan(db, warnings=["Risk warning: Stock has no fresh catalyst."])
    created = create_execution_intent(db, plan.id)

    blocked = approve_execution_intent(
        db,
        created.intent.id,
        acknowledge_warnings=False,
    )
    blocked_status = blocked.intent.status
    blocked_blockers = blocked.blockers
    blocked_warnings = blocked.warnings
    approved = approve_execution_intent(
        db,
        created.intent.id,
        acknowledge_warnings=True,
        approval_note="Warning reviewed",
    )

    assert blocked_status == "pending_approval"
    assert "Acknowledge the trade-plan warnings" in " ".join(blocked_blockers)
    assert set(plan.warnings).issubset(blocked_warnings)
    assert "Caution: TEST is not in the scanner table." in blocked_warnings
    assert approved.intent.status == "approved"
    assert approved.intent.approval_note == "Warning reviewed"
    outcomes = [
        (row.action, row.outcome)
        for row in db.query(AutomationAuditLog).order_by(AutomationAuditLog.id)
    ]
    assert ("intent_approval", "blocked") in outcomes
    assert ("intent_approved", "completed") in outcomes


def test_local_preflight_blocks_before_any_provider_call(db: Session):
    plan = _plan(db)
    intent = _approved_intent(db, plan)
    broker = FakeBroker()
    market = FakeMarketProvider()

    decision = _run(
        submit_execution_intent(
            db,
            intent.id,
            Settings(),
            broker=broker,
            market_provider=market,
        )
    )

    joined = " ".join(decision.blockers)
    assert "credentials are not configured" in joined
    assert "automation is disabled" in joined.lower()
    assert "kill switch is engaged" in joined.lower()
    assert decision.intent.status == "approved"
    assert broker.submit_calls == 0
    assert market.calls == 0
    audit = db.query(AutomationAuditLog).filter_by(action="submission_preflight").one()
    assert audit.outcome == "blocked"


def test_successful_submission_uses_one_protected_limit_bracket_order(db: Session):
    _enable_paper_automation(db)
    plan = _plan(db, target_price=11.0)
    intent = _approved_intent(db, plan)
    broker = FakeBroker()
    market = FakeMarketProvider()

    decision = _run(
        submit_execution_intent(
            db,
            intent.id,
            _app_settings(),
            broker=broker,
            market_provider=market,
        )
    )

    assert decision.blockers == ()
    assert decision.intent.status == "submitted"
    assert decision.intent.broker_order_id == "broker-order-1"
    assert broker.submit_calls == 1
    assert market.calls == 1
    request = broker.last_request
    assert request.symbol == "TEST"
    assert request.side == "buy"
    assert request.quantity == Decimal("100")
    assert request.limit_price == Decimal("10")
    assert request.time_in_force == "day"
    assert request.order_class == "bracket"
    assert request.take_profit_limit_price == Decimal("11")
    assert request.stop_loss_stop_price == Decimal("9.5")
    assert db.query(BrokerOrderEvent).count() == 1
    actions = {row.action for row in db.query(AutomationAuditLog).all()}
    assert {"submission_started", "order_submitted"}.issubset(actions)


@pytest.mark.parametrize(
    ("broker", "market", "expected"),
    [
        (MissingBuyingPowerBroker(), FakeMarketProvider(), "buying power is unavailable"),
        (OutsideTradingWindowBroker(), FakeMarketProvider(), "outside the configured trading window"),
        (FakeBroker(), DelayedMarketProvider(), "real-time quote"),
    ],
)
def test_submission_fails_closed_for_unverifiable_safety_inputs(
    db: Session,
    broker: FakeBroker,
    market: FakeMarketProvider,
    expected: str,
):
    _enable_paper_automation(db)
    intent = _approved_intent(db, _plan(db))

    decision = _run(
        submit_execution_intent(
            db,
            intent.id,
            _app_settings(),
            broker=broker,
            market_provider=market,
        )
    )

    assert expected in " ".join(decision.blockers)
    assert decision.intent.status == "approved"
    assert broker.submit_calls == 0


def test_plan_without_target_uses_oto_with_required_protective_stop(db: Session):
    _enable_paper_automation(db)
    plan = _plan(db, target_price=None)
    intent = _approved_intent(db, plan)
    broker = FakeBroker()

    decision = _run(
        submit_execution_intent(
            db,
            intent.id,
            _app_settings(),
            broker=broker,
            market_provider=FakeMarketProvider(),
        )
    )

    assert decision.intent.status == "submitted"
    assert broker.last_request.order_class == "oto"
    assert broker.last_request.take_profit_limit_price is None
    assert broker.last_request.stop_loss_stop_price == Decimal("9.5")


def test_ambiguous_submission_is_reconciled_and_never_blindly_retried(db: Session):
    _enable_paper_automation(db)
    plan = _plan(db)
    intent = _approved_intent(db, plan)
    broker = FakeBroker(ambiguous=True)
    market = FakeMarketProvider()

    first = _run(
        submit_execution_intent(
            db,
            intent.id,
            _app_settings(),
            broker=broker,
            market_provider=market,
        )
    )
    second = _run(
        submit_execution_intent(
            db,
            intent.id,
            _app_settings(),
            broker=broker,
            market_provider=market,
        )
    )

    assert first.intent.status == "submission_unknown"
    assert "will not be retried blindly" in first.warnings[0]
    assert second.intent.status == "submission_unknown"
    assert "may not be resubmitted" in second.blockers[0]
    assert broker.submit_calls == 1
    assert broker.lookup_calls == 3


def test_ambiguous_submission_recovers_existing_order_by_client_id(db: Session):
    _enable_paper_automation(db)
    plan = _plan(db)
    intent = _approved_intent(db, plan)
    broker = FakeBroker(ambiguous=True, lookup_order=_accepted_order)

    decision = _run(
        submit_execution_intent(
            db,
            intent.id,
            _app_settings(),
            broker=broker,
            market_provider=FakeMarketProvider(),
        )
    )

    assert decision.intent.status == "submitted"
    assert decision.intent.broker_order_id == "broker-order-1"
    assert broker.submit_calls == 1
    assert broker.lookup_calls == 3
    assert db.query(BrokerOrderEvent).count() == 1


def test_existing_order_is_recovered_by_deterministic_id_before_post(db: Session):
    _enable_paper_automation(db)
    intent = _approved_intent(db, _plan(db))
    existing = _broker_order(client_order_id=intent.client_order_id)
    broker = StaticLookupBroker(existing)
    market = FakeMarketProvider()

    decision = _run(
        submit_execution_intent(
            db,
            intent.id,
            _app_settings(),
            broker=broker,
            market_provider=market,
        )
    )

    assert decision.intent.status == "submitted"
    assert decision.intent.broker_order_id == existing.id
    assert broker.lookup_client_ids == [intent.client_order_id]
    assert broker.submit_calls == 0
    assert market.calls == 0
    audit = db.query(AutomationAuditLog).filter_by(action="order_recovered").one()
    assert audit.outcome == "submitted"


def test_inconclusive_idempotency_lookup_blocks_without_post(db: Session):
    _enable_paper_automation(db)
    intent = _approved_intent(db, _plan(db))
    broker = LookupFailureBroker()
    market = FakeMarketProvider()

    decision = _run(
        submit_execution_intent(
            db,
            intent.id,
            _app_settings(),
            broker=broker,
            market_provider=market,
        )
    )

    assert decision.intent.status == "approved"
    assert "idempotency lookup failed" in " ".join(decision.blockers).lower()
    assert "no order was sent" in " ".join(decision.blockers).lower()
    assert broker.lookup_calls == 1
    assert broker.submit_calls == 0
    assert market.calls == 0


@pytest.mark.parametrize(
    "dispatch_failure",
    [
        BrokerRequestError("submit returned 503", status_code=503),
        BrokerPayloadError("submit returned malformed success payload", status_code=200),
    ],
    ids=["request-error", "payload-error"],
)
def test_inconclusive_post_dispatch_failure_becomes_submission_unknown(
    db: Session,
    dispatch_failure: Exception,
):
    _enable_paper_automation(db)
    intent = _approved_intent(db, _plan(db))
    broker = PostDispatchFailureBroker(dispatch_failure)

    decision = _run(
        submit_execution_intent(
            db,
            intent.id,
            _app_settings(),
            broker=broker,
            market_provider=FakeMarketProvider(),
        )
    )

    assert decision.intent.status == "submission_unknown"
    assert "will not be retried blindly" in decision.warnings[0]
    assert broker.submit_calls == 1
    assert broker.lookup_calls == 3
    audit = db.query(AutomationAuditLog).filter_by(action="submission_unknown").one()
    assert audit.outcome == "unknown"


def test_future_dated_execution_quote_blocks_before_post(db: Session):
    _enable_paper_automation(db)
    intent = _approved_intent(db, _plan(db))
    broker = FakeBroker()
    market = FutureDatedMarketProvider()

    decision = _run(
        submit_execution_intent(
            db,
            intent.id,
            _app_settings(),
            broker=broker,
            market_provider=market,
        )
    )

    assert decision.intent.status == "approved"
    assert "implausibly in the future" in " ".join(decision.blockers)
    assert market.calls == 1
    assert broker.submit_calls == 0


def test_reconciliation_does_not_regress_partially_filled_intent(db: Session):
    _enable_paper_automation(db)
    intent = _approved_intent(db, _plan(db))
    intent.status = "partially_filled"
    intent.submitted_at = datetime.now(timezone.utc)
    db.commit()
    broker = StaticLookupBroker(
        _broker_order(client_order_id=intent.client_order_id, status="accepted")
    )

    result = _run(reconcile_execution_intents(db, _app_settings(), broker=broker))

    assert result == (1, 0)
    assert db.get(ExecutionIntent, intent.id).status == "partially_filled"
    assert db.query(BrokerOrderEvent).count() == 1


def test_filled_bracket_with_active_stop_remains_reconcilable_and_protected(db: Session):
    _enable_paper_automation(db)
    intent = _approved_intent(db, _plan(db))
    intent.status = "submitted"
    intent.submitted_at = datetime.now(timezone.utc)
    db.commit()
    stop_leg = _broker_order(
        client_order_id=f"{intent.client_order_id}-stop",
        order_id="broker-stop-1",
        status="held",
        side="sell",
        order_type="stop",
        order_class="",
        limit_price=None,
        stop_price=Decimal("9.5"),
    )
    parent = _broker_order(
        client_order_id=intent.client_order_id,
        status="filled",
        filled_quantity=Decimal("100"),
        legs=(stop_leg,),
    )

    result = _run(
        reconcile_execution_intents(
            db,
            _app_settings(),
            broker=StaticLookupBroker(parent),
        )
    )

    assert result == (1, 0)
    assert db.get(ExecutionIntent, intent.id).status == "entry_filled_protected"
    assert ensure_automation_settings(db).kill_switch_engaged is False


def test_filled_parent_fetches_nested_legs_before_classifying_protection(db: Session):
    _enable_paper_automation(db)
    intent = _approved_intent(db, _plan(db))
    intent.status = "submitted"
    intent.submitted_at = datetime.now(timezone.utc)
    db.commit()
    stop_leg = _broker_order(
        client_order_id=f"{intent.client_order_id}-stop",
        order_id="broker-stop-1",
        status="held",
        side="sell",
        order_type="stop",
        order_class="",
        limit_price=None,
        stop_price=Decimal("9.5"),
    )
    parent = _broker_order(
        client_order_id=intent.client_order_id,
        status="filled",
        filled_quantity=Decimal("100"),
    )
    nested_parent = replace(parent, legs=(stop_leg,))
    broker = NestedOrderBroker(parent, nested_parent)

    result = _run(reconcile_execution_intents(db, _app_settings(), broker=broker))

    assert result == (1, 0)
    assert broker.nested_calls == [(parent.id, True)]
    assert db.get(ExecutionIntent, intent.id).status == "entry_filled_protected"
    assert ensure_automation_settings(db).kill_switch_engaged is False


@pytest.mark.parametrize("stop_status", [None, "rejected"], ids=["missing-stop", "rejected-stop"])
def test_filled_bracket_without_active_stop_fails_closed(
    db: Session,
    stop_status: str | None,
):
    _enable_paper_automation(db)
    intent = _approved_intent(db, _plan(db))
    intent.status = "submitted"
    intent.submitted_at = datetime.now(timezone.utc)
    db.commit()
    legs: tuple[BrokerOrder, ...] = ()
    if stop_status is not None:
        legs = (
            _broker_order(
                client_order_id=f"{intent.client_order_id}-stop",
                order_id="broker-stop-1",
                status=stop_status,
                side="sell",
                order_type="stop",
                order_class="",
                limit_price=None,
                stop_price=Decimal("9.5"),
            ),
        )
    parent = _broker_order(
        client_order_id=intent.client_order_id,
        status="filled",
        filled_quantity=Decimal("100"),
        legs=legs,
    )

    result = _run(
        reconcile_execution_intents(
            db,
            _app_settings(),
            broker=StaticLookupBroker(parent),
        )
    )

    assert result == (1, 0)
    refreshed = db.get(ExecutionIntent, intent.id)
    assert refreshed.status == "protection_failed"
    assert "protective stop was not confirmed" in refreshed.failure_reason
    assert ensure_automation_settings(db).kill_switch_engaged is True
    audit = db.query(AutomationAuditLog).filter_by(action="protective_stop_missing").one()
    assert audit.outcome == "blocked"


def test_filled_exit_leg_closes_bracket_execution_lifecycle(db: Session):
    _enable_paper_automation(db)
    intent = _approved_intent(db, _plan(db))
    intent.status = "entry_filled_protected"
    intent.submitted_at = datetime.now(timezone.utc)
    db.commit()
    exit_leg = _broker_order(
        client_order_id=f"{intent.client_order_id}-take-profit",
        order_id="broker-take-profit-1",
        status="filled",
        side="sell",
        order_type="limit",
        order_class="",
        filled_quantity=Decimal("100"),
        limit_price=Decimal("11"),
    )
    parent = _broker_order(
        client_order_id=intent.client_order_id,
        status="filled",
        filled_quantity=Decimal("100"),
        legs=(exit_leg,),
    )

    result = _run(
        reconcile_execution_intents(
            db,
            _app_settings(),
            broker=StaticLookupBroker(parent),
        )
    )

    assert result == (1, 0)
    assert db.get(ExecutionIntent, intent.id).status == "filled"
    assert ensure_automation_settings(db).kill_switch_engaged is False
