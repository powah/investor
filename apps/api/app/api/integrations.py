from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.models.integrations import AutomationAuditLog, ExecutionIntent, ExternalNewsEvent
from app.models.trading import Catalyst, ScannerSymbol
from app.providers.broker import BrokerProviderError
from app.schemas.integrations import (
    AutomationAuditLogRead,
    AutomationRunRead,
    AutomationSettingsRead,
    AutomationSettingsUpdate,
    BrokerAccountRead,
    BrokerClockRead,
    BrokerOrderRead,
    BrokerPositionRead,
    BrokerSyncRead,
    ExecutionActionRead,
    ExecutionApprovalRequest,
    ExecutionIntentCreate,
    ExecutionIntentRead,
    ExternalNewsEventRead,
    IntegrationsStatusRead,
    KillSwitchUpdate,
    MarketDataSnapshotRead,
    NewsSyncRequest,
    PromoteNewsEventRequest,
    ProviderConnectionRead,
    SymbolSyncRequest,
    SyncProviderResultRead,
    SyncResultRead,
)
from app.services.automation import (
    AutomationNotFound,
    approve_execution_intent,
    create_execution_intent,
    ensure_automation_settings,
    run_automation_once,
    submit_execution_intent,
    update_automation_settings,
    update_kill_switch,
)
from app.services.feeds import (
    IntegrationNotConfigured,
    IntegrationProviderError,
    latest_market_snapshots,
    list_external_news,
    resolve_sync_symbols,
    sync_alpaca_market_data,
    sync_alpaca_news,
    sync_sec_filings,
)
from app.services.brokers import BrokerNotConfigured, UnsafeBrokerConfiguration, sync_broker


router = APIRouter(prefix="/integrations", tags=["integrations"])


def _alpaca_market_status(settings: Settings) -> ProviderConnectionRead:
    feed = settings.alpaca_scanner_feed
    entitlement_unverified = feed == "sip"
    is_realtime = feed == "iex"
    is_consolidated = feed in {"delayed_sip", "sip"}
    if not settings.alpaca_configured:
        message = "Add Alpaca paper credentials to enable market and news sync."
    elif feed == "iex":
        message = "Real-time IEX data for paper decisions; it is not a consolidated market view."
    elif feed == "delayed_sip":
        message = "Consolidated SIP scanner data with the free-plan delay clearly preserved."
    else:
        message = "Real-time consolidated SIP selected; the Alpaca account must have that entitlement."
    return ProviderConnectionRead(
        provider="alpaca",
        purpose="market_data",
        configured=settings.alpaca_configured,
        enabled=settings.alpaca_configured and not entitlement_unverified,
        environment="free" if feed != "sip" else "entitlement_unverified",
        source_feed=feed,
        real_time=is_realtime,
        is_consolidated=is_consolidated,
        message=message,
    )


@router.get("/status", response_model=IntegrationsStatusRead)
def integration_status(settings: Settings = Depends(get_settings)) -> IntegrationsStatusRead:
    alpaca_configured = settings.alpaca_configured
    paper_safe = (
        settings.alpaca_paper_mode
        and not settings.allow_live_trading
        and settings.alpaca_execution_feed == "iex"
    )
    return IntegrationsStatusRead(
        market_data=_alpaca_market_status(settings),
        news=ProviderConnectionRead(
            provider="alpaca",
            purpose="news",
            configured=alpaca_configured,
            enabled=alpaca_configured,
            environment="free_rest",
            source_feed="alpaca_news",
            real_time=False,
            is_consolidated=False,
            message=(
                "Alpaca News REST is ready; availability and freshness depend on account entitlement."
                if alpaca_configured
                else "Add Alpaca paper credentials to enable news sync."
            ),
        ),
        filings=ProviderConnectionRead(
            provider="sec_edgar",
            purpose="filings",
            configured=settings.sec_configured,
            enabled=settings.sec_configured,
            environment="public_api",
            source_feed="sec_submissions",
            real_time=False,
            is_consolidated=False,
            message=(
                "SEC EDGAR filing sync is ready. Imported filings require human catalyst review."
                if settings.sec_configured
                else "Set SEC_USER_AGENT to a contactable name and email to enable SEC sync."
            ),
        ),
        broker=ProviderConnectionRead(
            provider="alpaca",
            purpose="paper_broker",
            configured=alpaca_configured,
            enabled=alpaca_configured and paper_safe,
            environment=(
                "paper"
                if paper_safe
                else "blocked_unverified_sip"
                if settings.alpaca_execution_feed == "sip"
                else "blocked_non_paper"
            ),
            source_feed=settings.alpaca_execution_feed,
            real_time=settings.alpaca_execution_feed == "iex",
            is_consolidated=settings.alpaca_execution_feed == "sip",
            message=(
                "Paper broker is configured. Automation remains disarmed until explicitly enabled."
                if alpaca_configured and paper_safe
                else "Broker execution is blocked: only Alpaca paper trading is allowed."
                if alpaca_configured
                else "Add Alpaca paper credentials to connect the paper broker."
            ),
        ),
    )


@router.get("/automation/settings", response_model=AutomationSettingsRead)
def get_automation_settings(db: Session = Depends(get_db)):
    return ensure_automation_settings(db)


@router.put("/automation/settings", response_model=AutomationSettingsRead)
def put_automation_settings(
    payload: AutomationSettingsUpdate,
    db: Session = Depends(get_db),
):
    return update_automation_settings(db, payload.model_dump(exclude_unset=True))


@router.post("/automation/kill-switch", response_model=AutomationSettingsRead)
def set_automation_kill_switch(
    payload: KillSwitchUpdate,
    db: Session = Depends(get_db),
):
    return update_kill_switch(db, engaged=payload.engaged, confirmation=payload.confirmation)


@router.get("/executions", response_model=list[ExecutionIntentRead])
def list_execution_intents(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    return db.query(ExecutionIntent).order_by(ExecutionIntent.created_at.desc()).limit(limit).all()


@router.post("/executions", response_model=ExecutionActionRead, status_code=status.HTTP_201_CREATED)
def prepare_execution_intent(
    payload: ExecutionIntentCreate,
    db: Session = Depends(get_db),
) -> ExecutionActionRead:
    try:
        decision = create_execution_intent(
            db,
            payload.trade_plan_id,
            order_type=payload.order_type,
            time_in_force=payload.time_in_force,
        )
    except AutomationNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ExecutionActionRead(intent=decision.intent, blockers=list(decision.blockers), warnings=list(decision.warnings))


@router.post("/executions/{intent_id}/approve", response_model=ExecutionActionRead)
def approve_intent(
    intent_id: int,
    payload: ExecutionApprovalRequest,
    db: Session = Depends(get_db),
) -> ExecutionActionRead:
    try:
        decision = approve_execution_intent(
            db,
            intent_id,
            acknowledge_warnings=payload.acknowledge_warnings,
            approval_note=payload.approval_note,
        )
    except AutomationNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ExecutionActionRead(intent=decision.intent, blockers=list(decision.blockers), warnings=list(decision.warnings))


@router.post("/executions/{intent_id}/submit", response_model=ExecutionActionRead)
async def submit_intent(
    intent_id: int,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> ExecutionActionRead:
    try:
        decision = await submit_execution_intent(db, intent_id, settings)
    except AutomationNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ExecutionActionRead(intent=decision.intent, blockers=list(decision.blockers), warnings=list(decision.warnings))


@router.post("/automation/run", response_model=AutomationRunRead)
async def run_automation(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> AutomationRunRead:
    if settings.allow_live_trading or not settings.alpaca_paper_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Automation requires the exact Alpaca paper endpoint with live trading disabled."
            ),
        )
    try:
        stats = await run_automation_once(db, settings)
    except UnsafeBrokerConfiguration as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    return AutomationRunRead(
        processed=stats.processed,
        submitted=stats.submitted,
        reconciled=stats.reconciled,
        failed=stats.failed,
    )


@router.get("/automation/audit", response_model=list[AutomationAuditLogRead])
def list_automation_audit(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    return db.query(AutomationAuditLog).order_by(AutomationAuditLog.created_at.desc()).limit(limit).all()


@router.get("/broker/sync", response_model=BrokerSyncRead)
async def get_broker_sync(settings: Settings = Depends(get_settings)) -> BrokerSyncRead:
    try:
        synced = await sync_broker(settings)
    except BrokerNotConfigured as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except UnsafeBrokerConfiguration as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except BrokerProviderError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Alpaca paper broker request failed: {exc}",
        ) from exc

    account = synced.account
    clock = synced.clock
    return BrokerSyncRead(
        account=BrokerAccountRead(
            provider="alpaca",
            environment="paper",
            account_id=account.id,
            status=account.status,
            currency=account.currency,
            buying_power=account.buying_power,
            cash=account.cash,
            equity=account.equity,
            trading_blocked=account.trading_blocked,
            account_blocked=account.account_blocked,
            trade_suspended_by_user=account.trade_suspended_by_user,
        ),
        clock=BrokerClockRead(
            provider="alpaca",
            timestamp=clock.timestamp,
            is_open=clock.is_open,
            next_open=clock.next_open,
            next_close=clock.next_close,
        ),
        positions=[
            BrokerPositionRead(
                provider="alpaca",
                symbol=position.symbol,
                quantity=position.quantity,
                available_quantity=position.quantity_available,
                side=position.side,
                average_entry_price=position.average_entry_price,
                current_price=position.current_price,
                market_value=position.market_value,
                unrealized_pl=position.unrealized_profit_loss,
            )
            for position in synced.positions
        ],
        orders=[
            BrokerOrderRead(
                provider="alpaca",
                id=order.id,
                client_order_id=order.client_order_id,
                symbol=order.symbol,
                side=order.side,
                order_type=order.order_type,
                time_in_force=order.time_in_force,
                status=order.status,
                quantity=order.quantity,
                filled_quantity=order.filled_quantity,
                filled_average_price=order.filled_average_price,
                limit_price=order.limit_price,
                stop_price=order.stop_price,
                submitted_at=order.submitted_at,
                updated_at=order.updated_at,
                raw=jsonable_encoder(asdict(order)),
            )
            for order in synced.orders
        ],
    )


@router.post("/market-data/sync", response_model=SyncResultRead)
async def sync_market_data(
    payload: SymbolSyncRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> SyncResultRead:
    if (payload.feed or settings.alpaca_scanner_feed) == "sip":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Paid SIP entitlement is not verified or enabled in this free-source release.",
        )
    symbols = resolve_sync_symbols(db, payload.symbols)
    if not symbols:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Add symbols to the scanner/watchlist or include symbols in this request.",
        )
    try:
        _, snapshots = await sync_alpaca_market_data(db, settings, symbols, feed=payload.feed)
    except IntegrationNotConfigured as exc:
        return SyncResultRead(results=[SyncProviderResultRead(provider="alpaca", status="skipped", message=str(exc))])
    except IntegrationProviderError as exc:
        return SyncResultRead(results=[SyncProviderResultRead(provider="alpaca", status="failed", message=str(exc))])
    return SyncResultRead(
        results=[SyncProviderResultRead(provider="alpaca", status="completed", records_count=len(snapshots))],
        snapshots=snapshots,
    )


@router.get("/market-data/snapshots", response_model=list[MarketDataSnapshotRead])
def get_market_snapshots(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    return latest_market_snapshots(db, limit=limit)


@router.post("/news/sync", response_model=SyncResultRead)
async def sync_news(
    payload: NewsSyncRequest,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> SyncResultRead:
    symbols = resolve_sync_symbols(db, payload.symbols)
    if not symbols:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Add symbols to the scanner/watchlist or include symbols in this request.",
        )

    results: list[SyncProviderResultRead] = []
    events: list[ExternalNewsEvent] = []
    if "alpaca" in payload.providers:
        try:
            _, alpaca_events = await sync_alpaca_news(
                db,
                settings,
                symbols,
                since_hours=payload.since_hours,
                limit=payload.limit,
            )
            events.extend(alpaca_events)
            results.append(
                SyncProviderResultRead(provider="alpaca", status="completed", records_count=len(alpaca_events))
            )
        except IntegrationNotConfigured as exc:
            results.append(SyncProviderResultRead(provider="alpaca", status="skipped", message=str(exc)))
        except IntegrationProviderError as exc:
            results.append(SyncProviderResultRead(provider="alpaca", status="failed", message=str(exc)))

    if "sec" in payload.providers:
        try:
            _, sec_events = await sync_sec_filings(db, settings, symbols, since_hours=payload.since_hours)
            events.extend(sec_events)
            results.append(
                SyncProviderResultRead(provider="sec_edgar", status="completed", records_count=len(sec_events))
            )
        except IntegrationNotConfigured as exc:
            results.append(SyncProviderResultRead(provider="sec_edgar", status="skipped", message=str(exc)))
        except IntegrationProviderError as exc:
            results.append(SyncProviderResultRead(provider="sec_edgar", status="failed", message=str(exc)))

    return SyncResultRead(results=results, news_events=events)


@router.get("/news-events", response_model=list[ExternalNewsEventRead])
def get_news_events(
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    return list_external_news(db, limit=limit)


@router.post(
    "/news-events/{event_id}/promote",
    response_model=ExternalNewsEventRead,
    status_code=status.HTTP_200_OK,
)
def promote_news_event(
    event_id: int,
    payload: PromoteNewsEventRequest,
    db: Session = Depends(get_db),
) -> ExternalNewsEvent:
    event = db.get(ExternalNewsEvent, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="External event not found.")

    if event.promoted_catalyst_id is None:
        catalyst = Catalyst(
            ticker=event.ticker,
            published_time=event.published_at,
            source=event.source,
            headline=event.headline,
            catalyst_type=payload.catalyst_type.strip(),
            quality_score=payload.quality_score,
        )
        db.add(catalyst)
        db.flush()
        event.promoted_catalyst_id = catalyst.id
        symbol = db.query(ScannerSymbol).filter(ScannerSymbol.ticker == event.ticker).one_or_none()
        if symbol is not None:
            symbol.catalyst_type = catalyst.catalyst_type
            symbol.news_headline = catalyst.headline
    event.observed_at = event.observed_at or datetime.now(timezone.utc)
    db.commit()
    db.refresh(event)
    return event
