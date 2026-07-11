from datetime import date
from types import SimpleNamespace

import pytest

from app.services.risk import evaluate_trade_plan


PLAN_DATE = date(2026, 7, 11)


def _settings(**overrides):
    values = {
        "max_daily_loss": 150,
        "max_trades_per_day": 5,
        "max_consecutive_losses": 3,
        "max_position_shares": 10_000,
        "min_score_to_plan": 65,
        "max_spread_pct": 1.5,
        "require_above_vwap": True,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def _journal_entry(entry_id: int, pnl: float, trade_date: date = PLAN_DATE):
    return SimpleNamespace(id=entry_id, pnl=pnl, trade_date=trade_date)


def _evaluate(*, journal_entries=None, settings=None, **overrides):
    values = {
        "ticker": "SINT",
        "trade_date": PLAN_DATE,
        "account_size": 10_000,
        "max_risk_per_trade_pct": 0.5,
        "entry_price": 4.20,
        "stop_price": 4.00,
        "target_price": 4.60,
        "symbol": None,
        "catalyst": None,
        "settings": settings or _settings(),
        "journal_entries": journal_entries or [],
    }
    values.update(overrides)
    return evaluate_trade_plan(**values)


def test_sizes_position_from_account_risk():
    result = _evaluate()

    assert result.risk_per_share == 0.20
    assert result.shares == 250
    assert result.max_loss == 50.00
    assert result.r_multiple == 2.00
    assert result.blockers == []


@pytest.mark.parametrize(
    ("stop_price", "expected_blocker"),
    [
        (None, "Invalid trade plan: Stop price is missing."),
        (4.20, "Invalid trade plan: Stop must be below entry for a long momentum setup."),
        (4.30, "Invalid trade plan: Stop must be below entry for a long momentum setup."),
    ],
)
def test_invalid_stops_are_blocked(stop_price, expected_blocker):
    result = _evaluate(stop_price=stop_price)

    assert expected_blocker in result.blockers
    assert result.shares == 0


def test_daily_loss_limit_blocks_plan():
    entries = [
        _journal_entry(1, -100),
        _journal_entry(2, -50),
        _journal_entry(3, 500, date(2026, 7, 10)),
    ]

    result = _evaluate(journal_entries=entries)

    assert "Daily lockout: Max daily loss reached. No more trades today." in result.blockers


def test_consecutive_loss_limit_only_counts_plan_date():
    previous_date = date(2026, 7, 10)
    previous_losses = [_journal_entry(entry_id, -10, previous_date) for entry_id in range(1, 4)]
    current_losses = [_journal_entry(entry_id, -10) for entry_id in range(4, 6)]

    below_limit = _evaluate(journal_entries=previous_losses + current_losses)
    at_limit = _evaluate(journal_entries=previous_losses + current_losses + [_journal_entry(6, -10)])

    assert "Daily lockout: Max consecutive losses reached." not in below_limit.blockers
    assert "Daily lockout: Max consecutive losses reached." in at_limit.blockers


def test_position_above_share_limit_is_blocked():
    result = _evaluate(settings=_settings(max_position_shares=249))

    assert result.shares == 250
    assert "Invalid trade plan: Position size exceeds your defined share limit." in result.blockers
    assert "Risk warning: Position size exceeds your defined share limit." not in result.warnings
