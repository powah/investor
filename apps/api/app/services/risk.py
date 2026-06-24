from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from math import floor
from typing import Optional

from app.models.trading import JournalEntry, RiskSettings, ScannerSymbol
from app.services.scoring import score_symbol


@dataclass
class RiskResult:
    risk_per_share: float
    shares: int
    max_loss: float
    r_multiple: Optional[float]
    warnings: list[str]
    blockers: list[str]


def _daily_realized_pnl(entries: list[JournalEntry], trade_date: date) -> float:
    return sum(entry.pnl for entry in entries if entry.trade_date == trade_date)


def _daily_trade_count(entries: list[JournalEntry], trade_date: date) -> int:
    return sum(1 for entry in entries if entry.trade_date == trade_date)


def _consecutive_losses(entries: list[JournalEntry]) -> int:
    ordered = sorted(entries, key=lambda entry: (entry.trade_date, entry.id), reverse=True)
    losses = 0
    for entry in ordered:
        if entry.pnl < 0:
            losses += 1
            continue
        break
    return losses


def evaluate_trade_plan(
    *,
    ticker: str,
    trade_date: date,
    account_size: float,
    max_risk_per_trade_pct: float,
    entry_price: float,
    stop_price: Optional[float],
    target_price: Optional[float],
    symbol: Optional[ScannerSymbol],
    settings: RiskSettings,
    journal_entries: list[JournalEntry],
) -> RiskResult:
    warnings: list[str] = []
    blockers: list[str] = []

    if stop_price is None:
        blockers.append("Invalid trade plan: Stop price is missing.")
        return RiskResult(0, 0, 0, None, warnings, blockers)

    if entry_price <= 0:
        blockers.append("Invalid trade plan: Entry price must be above zero.")

    if stop_price <= 0:
        blockers.append("Invalid trade plan: Stop price must be above zero.")

    if stop_price >= entry_price:
        blockers.append("Invalid trade plan: Stop must be below entry for a long momentum setup.")

    if blockers:
        return RiskResult(0, 0, 0, None, warnings, blockers)

    daily_pnl = _daily_realized_pnl(journal_entries, trade_date)
    if daily_pnl <= -abs(settings.max_daily_loss):
        blockers.append("Daily lockout: Max daily loss reached. No more trades today.")

    if _daily_trade_count(journal_entries, trade_date) >= settings.max_trades_per_day:
        blockers.append("Daily lockout: Max trades per day reached.")

    if _consecutive_losses(journal_entries) >= settings.max_consecutive_losses:
        blockers.append("Daily lockout: Max consecutive losses reached.")

    risk_per_share = entry_price - stop_price
    cash_risk = account_size * (max_risk_per_trade_pct / 100)
    shares = floor(cash_risk / risk_per_share) if risk_per_share > 0 else 0
    max_loss = shares * risk_per_share

    if risk_per_share / entry_price > 0.15:
        warnings.append("Risk warning: Risk per share is more than 15% of entry.")

    if shares <= 0:
        blockers.append("Invalid trade plan: Position size is zero at the selected risk.")

    if shares > settings.max_position_shares:
        warnings.append("Risk warning: Position size exceeds your defined share limit.")

    r_multiple = None
    if target_price is not None and risk_per_share > 0:
        r_multiple = (target_price - entry_price) / risk_per_share
        if r_multiple < 1:
            warnings.append("Caution: Target is less than 1R from entry.")

    if symbol is None:
        warnings.append(f"Caution: {ticker.upper()} is not in the scanner table.")
    else:
        scored = score_symbol(symbol)
        if scored["score"] < settings.min_score_to_plan:
            warnings.append("Risk warning: Score is below your minimum required plan score.")

        if symbol.spread_pct > settings.max_spread_pct:
            warnings.append("Caution: Spread is wider than your allowed threshold.")

        if not symbol.news_headline:
            warnings.append("Risk warning: Stock has no fresh catalyst.")

        if settings.require_above_vwap and not symbol.above_vwap:
            warnings.append("Risk warning: Stock is below VWAP when strategy requires VWAP confirmation.")

    return RiskResult(
        risk_per_share=round(risk_per_share, 4),
        shares=shares,
        max_loss=round(max_loss, 2),
        r_multiple=round(r_multiple, 2) if r_multiple is not None else None,
        warnings=warnings,
        blockers=blockers,
    )
