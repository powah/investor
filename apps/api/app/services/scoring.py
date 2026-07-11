from datetime import datetime, timedelta, timezone
from typing import Optional

from app.models.trading import Catalyst, ScannerSymbol


CATALYST_FRESHNESS_WINDOW = timedelta(hours=72)
WEAK_CATALYST_TYPES = {
    "vague pr",
    "paid promotion",
    "old news",
    "reverse split",
    "offering",
    "dilution",
    "none",
    "no fresh news",
}


def score_label(score: int) -> str:
    if score >= 80:
        return "A+ watch"
    if score >= 65:
        return "Watch"
    if score >= 50:
        return "Weak"
    return "Ignore"


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _catalyst_freshness(catalyst: Optional[Catalyst], now: datetime) -> tuple[bool, bool]:
    if catalyst is None:
        return False, False
    age = _as_utc(now) - _as_utc(catalyst.published_time)
    return timedelta(0) <= age <= CATALYST_FRESHNESS_WINDOW, age < timedelta(0)


def score_symbol(
    symbol: ScannerSymbol,
    catalyst: Optional[Catalyst] = None,
    *,
    now: Optional[datetime] = None,
) -> dict:
    score = 0
    reasons: list[str] = []
    risk_warnings: list[str] = []
    evaluated_at = _as_utc(now or datetime.now(timezone.utc))
    catalyst_is_fresh, catalyst_is_future = _catalyst_freshness(catalyst, evaluated_at)
    catalyst_quality = max(0, min(20, int(catalyst.quality_score))) if catalyst is not None else None
    catalyst_type = (catalyst.catalyst_type or "").strip().lower() if catalyst is not None else ""
    catalyst_is_weak = catalyst is not None and (
        catalyst_type in WEAK_CATALYST_TYPES or catalyst_quality == 0
    )

    if catalyst is None:
        risk_warnings.append("No catalyst record is available; catalyst points: 0.")
    elif catalyst_is_future:
        risk_warnings.append("Latest catalyst publication time is in the future; catalyst points: 0.")
    elif not catalyst_is_fresh:
        risk_warnings.append("Latest catalyst is stale (older than 72 hours); catalyst points: 0.")
    elif catalyst_is_weak:
        risk_warnings.append("Latest catalyst is weak; catalyst points: 0.")
    else:
        score += catalyst_quality or 0
        reasons.append(f"Fresh {catalyst.catalyst_type} catalyst quality {catalyst_quality}/20")

    if symbol.gap_pct > 10:
        score += 10
        reasons.append("Gap above 10%")

    if symbol.rel_volume > 5:
        score += 15
        reasons.append("Relative volume above 5x")

    if 0 < symbol.float_m < 20:
        score += 10
        reasons.append("Float under 20M")
    elif symbol.float_m >= 50:
        risk_warnings.append("Float is elevated for a small-cap momentum setup.")

    if symbol.clean_daily_chart_room:
        score += 10
        reasons.append("Clean daily chart room")

    if symbol.above_vwap:
        score += 10
        reasons.append("Above VWAP")
    else:
        risk_warnings.append("Stock is below VWAP when VWAP confirmation is preferred.")

    if 0 < symbol.spread_pct <= 1.5:
        score += 10
        reasons.append("Spread within liquidity threshold")
    elif symbol.spread_pct <= 0:
        risk_warnings.append("Spread is unknown; liquidity points: 0.")
    else:
        risk_warnings.append("Spread is wider than the allowed threshold.")

    if symbol.holding_key_level:
        score += 10
        reasons.append("Holding key level")

    if symbol.no_dilution_red_flag:
        score += 5
        reasons.append("No obvious dilution red flag")
    else:
        risk_warnings.append("No dilution clearance has been verified.")

    score = max(0, min(100, score))
    return {
        "score": score,
        "label": score_label(score),
        "reasons": reasons,
        "risk_warnings": risk_warnings,
        "latest_catalyst_quality_score": catalyst_quality,
        "latest_catalyst_published_time": _as_utc(catalyst.published_time) if catalyst is not None else None,
        "latest_catalyst_is_fresh": catalyst_is_fresh,
    }
