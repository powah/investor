from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.schemas.trading import ScannerSymbolCreate
from app.services.scoring import score_symbol


NOW = datetime(2026, 7, 11, 14, 0, tzinfo=timezone.utc)


def _symbol(**overrides):
    values = ScannerSymbolCreate(ticker="TEST", price=2.0).model_dump()
    values.update(overrides)
    return SimpleNamespace(**values)


def _catalyst(*, quality_score=20, catalyst_type="FDA", published_time=None):
    return SimpleNamespace(
        quality_score=quality_score,
        catalyst_type=catalyst_type,
        published_time=published_time or NOW - timedelta(hours=1),
    )


def test_fresh_catalyst_uses_quality_score_as_points():
    catalyst = _catalyst(quality_score=13)

    result = score_symbol(_symbol(), catalyst, now=NOW)

    assert result["score"] == 13
    assert result["latest_catalyst_quality_score"] == 13
    assert result["latest_catalyst_published_time"] == catalyst.published_time
    assert result["latest_catalyst_is_fresh"] is True
    assert "Fresh FDA catalyst quality 13/20" in result["reasons"]


def test_stale_catalyst_receives_no_points_and_warning():
    catalyst = _catalyst(published_time=NOW - timedelta(hours=72, seconds=1))

    result = score_symbol(_symbol(), catalyst, now=NOW)

    assert result["score"] == 0
    assert result["latest_catalyst_is_fresh"] is False
    assert "Latest catalyst is stale (older than 72 hours); catalyst points: 0." in result["risk_warnings"]


def test_fresh_weak_catalyst_receives_no_points_and_warning():
    result = score_symbol(_symbol(), _catalyst(catalyst_type="Offering"), now=NOW)

    assert result["score"] == 0
    assert result["latest_catalyst_is_fresh"] is True
    assert "Latest catalyst is weak; catalyst points: 0." in result["risk_warnings"]


def test_zero_spread_is_unknown_and_receives_no_liquidity_points():
    result = score_symbol(_symbol(spread_pct=0), None, now=NOW)

    assert "Spread within liquidity threshold" not in result["reasons"]
    assert "Spread is unknown; liquidity points: 0." in result["risk_warnings"]


def test_unknown_optional_factors_default_to_neutral():
    symbol = ScannerSymbolCreate(ticker="TEST", price=2.0)

    assert symbol.clean_daily_chart_room is False
    assert symbol.holding_key_level is False
    assert symbol.no_dilution_red_flag is False
    assert score_symbol(SimpleNamespace(**symbol.model_dump()), None, now=NOW)["score"] == 0
