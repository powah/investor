from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.trading import Catalyst, JournalEntry, RiskSettings, ScannerSymbol, TradePlan, WatchlistItem
from app.schemas.trading import (
    AnalyticsRead,
    CatalystCreate,
    CatalystRead,
    JournalCreate,
    JournalRead,
    RiskSettingsRead,
    RiskSettingsUpdate,
    ScannerStatusUpdate,
    ScannerSymbolCreate,
    ScannerSymbolRead,
    TradePlanCreate,
    TradePlanRead,
    WatchlistCreate,
    WatchlistRead,
)
from app.services.analytics import summarize_journal
from app.services.risk import evaluate_trade_plan
from app.services.scoring import score_symbol
from app.services.seed import ensure_risk_settings, import_sample_scanner_data

router = APIRouter()


def _ticker(value: str) -> str:
    return value.strip().upper()


def _scanner_read(symbol: ScannerSymbol) -> ScannerSymbolRead:
    data = ScannerSymbolRead.model_validate(
        {
            **symbol.__dict__,
            **score_symbol(symbol),
        }
    )
    return data


def _watchlist_read(item: WatchlistItem, db: Session) -> WatchlistRead:
    symbol = db.query(ScannerSymbol).filter(ScannerSymbol.ticker == item.ticker).one_or_none()
    return WatchlistRead(
        id=item.id,
        ticker=item.ticker,
        notes=item.notes,
        created_at=item.created_at,
        symbol=_scanner_read(symbol) if symbol else None,
    )


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


@router.get("/scanner", response_model=list[ScannerSymbolRead])
def list_scanner(db: Session = Depends(get_db)) -> list[ScannerSymbolRead]:
    symbols = db.query(ScannerSymbol).all()
    return sorted([_scanner_read(symbol) for symbol in symbols], key=lambda item: item.score, reverse=True)


@router.post("/scanner", response_model=ScannerSymbolRead, status_code=status.HTTP_201_CREATED)
def upsert_scanner_symbol(payload: ScannerSymbolCreate, db: Session = Depends(get_db)) -> ScannerSymbolRead:
    ticker = _ticker(payload.ticker)
    symbol = db.query(ScannerSymbol).filter(ScannerSymbol.ticker == ticker).one_or_none()
    if symbol is None:
        symbol = ScannerSymbol(ticker=ticker)
        db.add(symbol)

    for field, value in payload.model_dump(exclude={"ticker"}).items():
        setattr(symbol, field, value)
    db.commit()
    db.refresh(symbol)
    return _scanner_read(symbol)


@router.post("/scanner/import-sample", response_model=list[ScannerSymbolRead])
def import_sample_scanner(db: Session = Depends(get_db)) -> list[ScannerSymbolRead]:
    symbols = import_sample_scanner_data(db)
    return sorted([_scanner_read(symbol) for symbol in symbols], key=lambda item: item.score, reverse=True)


@router.patch("/scanner/{ticker}/status", response_model=ScannerSymbolRead)
def update_scanner_status(
    ticker: str,
    payload: ScannerStatusUpdate,
    db: Session = Depends(get_db),
) -> ScannerSymbolRead:
    symbol = db.query(ScannerSymbol).filter(ScannerSymbol.ticker == _ticker(ticker)).one_or_none()
    if symbol is None:
        raise HTTPException(status_code=404, detail="Ticker not found in scanner.")

    symbol.status = payload.status
    if payload.status == "watch":
        existing = db.query(WatchlistItem).filter(WatchlistItem.ticker == symbol.ticker).one_or_none()
        if existing is None:
            db.add(WatchlistItem(ticker=symbol.ticker))
    elif payload.status in {"candidate", "ignore"}:
        existing = db.query(WatchlistItem).filter(WatchlistItem.ticker == symbol.ticker).one_or_none()
        if existing is not None:
            db.delete(existing)

    db.commit()
    db.refresh(symbol)
    return _scanner_read(symbol)


@router.get("/catalysts", response_model=list[CatalystRead])
def list_catalysts(db: Session = Depends(get_db)) -> list[Catalyst]:
    return db.query(Catalyst).order_by(Catalyst.published_time.desc()).all()


@router.post("/catalysts", response_model=CatalystRead, status_code=status.HTTP_201_CREATED)
def create_catalyst(payload: CatalystCreate, db: Session = Depends(get_db)) -> Catalyst:
    ticker = _ticker(payload.ticker)
    catalyst = Catalyst(**payload.model_dump(exclude={"ticker"}), ticker=ticker)
    db.add(catalyst)

    symbol = db.query(ScannerSymbol).filter(ScannerSymbol.ticker == ticker).one_or_none()
    if symbol is not None:
        symbol.catalyst_type = payload.catalyst_type
        symbol.news_headline = payload.headline
    db.commit()
    db.refresh(catalyst)
    return catalyst


@router.get("/watchlist", response_model=list[WatchlistRead])
def list_watchlist(db: Session = Depends(get_db)) -> list[WatchlistRead]:
    items = db.query(WatchlistItem).order_by(WatchlistItem.created_at.desc()).all()
    return [_watchlist_read(item, db) for item in items]


@router.post("/watchlist", response_model=WatchlistRead, status_code=status.HTTP_201_CREATED)
def add_watchlist_item(payload: WatchlistCreate, db: Session = Depends(get_db)) -> WatchlistRead:
    ticker = _ticker(payload.ticker)
    item = db.query(WatchlistItem).filter(WatchlistItem.ticker == ticker).one_or_none()
    if item is None:
        item = WatchlistItem(ticker=ticker, notes=payload.notes)
        db.add(item)
    else:
        item.notes = payload.notes

    symbol = db.query(ScannerSymbol).filter(ScannerSymbol.ticker == ticker).one_or_none()
    if symbol is not None:
        symbol.status = "watch"

    db.commit()
    db.refresh(item)
    return _watchlist_read(item, db)


@router.delete("/watchlist/{ticker}", status_code=status.HTTP_204_NO_CONTENT)
def remove_watchlist_item(ticker: str, db: Session = Depends(get_db)) -> None:
    item = db.query(WatchlistItem).filter(WatchlistItem.ticker == _ticker(ticker)).one_or_none()
    if item is not None:
        db.delete(item)

    symbol = db.query(ScannerSymbol).filter(ScannerSymbol.ticker == _ticker(ticker)).one_or_none()
    if symbol is not None and symbol.status == "watch":
        symbol.status = "candidate"

    db.commit()


@router.get("/risk-settings", response_model=RiskSettingsRead)
def get_risk_settings(db: Session = Depends(get_db)) -> RiskSettings:
    return ensure_risk_settings(db)


@router.put("/risk-settings", response_model=RiskSettingsRead)
def update_risk_settings(payload: RiskSettingsUpdate, db: Session = Depends(get_db)) -> RiskSettings:
    settings = ensure_risk_settings(db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(settings, field, value)
    db.commit()
    db.refresh(settings)
    return settings


@router.get("/trade-plans", response_model=list[TradePlanRead])
def list_trade_plans(db: Session = Depends(get_db)) -> list[TradePlan]:
    return db.query(TradePlan).order_by(TradePlan.created_at.desc()).all()


@router.post("/trade-plans", response_model=TradePlanRead, status_code=status.HTTP_201_CREATED)
def create_trade_plan(payload: TradePlanCreate, db: Session = Depends(get_db)) -> TradePlan:
    ticker = _ticker(payload.ticker)
    settings = ensure_risk_settings(db)
    symbol = db.query(ScannerSymbol).filter(ScannerSymbol.ticker == ticker).one_or_none()
    journal_entries = db.query(JournalEntry).order_by(JournalEntry.trade_date.desc(), JournalEntry.id.desc()).all()

    account_size = payload.account_size or settings.account_size
    max_risk_pct = payload.max_risk_per_trade_pct or settings.max_risk_per_trade_pct
    result = evaluate_trade_plan(
        ticker=ticker,
        trade_date=payload.plan_date,
        account_size=account_size,
        max_risk_per_trade_pct=max_risk_pct,
        entry_price=payload.entry_price,
        stop_price=payload.stop_price,
        target_price=payload.target_price,
        symbol=symbol,
        settings=settings,
        journal_entries=journal_entries,
    )

    if result.blockers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"blockers": result.blockers, "warnings": result.warnings},
        )

    plan = TradePlan(
        plan_date=payload.plan_date,
        ticker=ticker,
        account_size=account_size,
        max_risk_per_trade_pct=max_risk_pct,
        entry_price=payload.entry_price,
        stop_price=payload.stop_price,
        target_price=payload.target_price,
        risk_per_share=result.risk_per_share,
        shares=result.shares,
        max_loss=result.max_loss,
        r_multiple=result.r_multiple,
        warnings=result.warnings,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


@router.get("/journal", response_model=list[JournalRead])
def list_journal(db: Session = Depends(get_db)) -> list[JournalEntry]:
    return db.query(JournalEntry).order_by(JournalEntry.trade_date.desc(), JournalEntry.id.desc()).all()


@router.post("/journal", response_model=JournalRead, status_code=status.HTTP_201_CREATED)
def create_journal_entry(payload: JournalCreate, db: Session = Depends(get_db)) -> JournalEntry:
    ticker = _ticker(payload.ticker)
    risk_cash = (payload.entry_price - payload.stop_price) * payload.shares
    pnl = payload.pnl if payload.pnl is not None else (payload.exit_price - payload.entry_price) * payload.shares
    r_multiple = payload.r_multiple if payload.r_multiple is not None else (pnl / risk_cash if risk_cash > 0 else 0)

    entry = JournalEntry(
        trade_date=payload.trade_date,
        ticker=ticker,
        setup=payload.setup,
        catalyst_type=payload.catalyst_type,
        entry_price=payload.entry_price,
        stop_price=payload.stop_price,
        exit_price=payload.exit_price,
        shares=payload.shares,
        pnl=round(pnl, 2),
        r_multiple=round(r_multiple, 2),
        notes=payload.notes,
        mistake_tags=payload.mistake_tags,
        followed_plan=payload.followed_plan,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/analytics", response_model=AnalyticsRead)
def get_analytics(db: Session = Depends(get_db)) -> dict:
    entries = db.query(JournalEntry).all()
    return summarize_journal(entries)


@router.get("/risk-state")
def get_risk_state(db: Session = Depends(get_db)) -> dict:
    settings = ensure_risk_settings(db)
    today = date.today()
    entries = db.query(JournalEntry).all()
    realized_pnl = sum(entry.pnl for entry in entries if entry.trade_date == today)
    trades_today = sum(1 for entry in entries if entry.trade_date == today)
    return {
        "date": today,
        "daily_realized_pnl": round(realized_pnl, 2),
        "daily_loss_remaining": round(settings.max_daily_loss + realized_pnl, 2),
        "trades_today": trades_today,
        "max_trades_per_day": settings.max_trades_per_day,
        "daily_lockout": realized_pnl <= -abs(settings.max_daily_loss),
    }
