from app.models.trading import ScannerSymbol


STRONG_CATALYST_TYPES = {
    "fda",
    "clinical data",
    "earnings",
    "contract",
    "merger",
    "acquisition",
    "m&a",
    "guidance",
    "analyst action",
    "partnership",
}

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


def has_fresh_strong_catalyst(symbol: ScannerSymbol) -> bool:
    catalyst_type = (symbol.catalyst_type or "").strip().lower()
    has_headline = bool((symbol.news_headline or "").strip())
    return has_headline and catalyst_type in STRONG_CATALYST_TYPES


def has_weak_catalyst(symbol: ScannerSymbol) -> bool:
    catalyst_type = (symbol.catalyst_type or "").strip().lower()
    return catalyst_type in WEAK_CATALYST_TYPES or not (symbol.news_headline or "").strip()


def score_symbol(symbol: ScannerSymbol) -> dict:
    score = 0
    reasons: list[str] = []
    risk_warnings: list[str] = []

    if has_fresh_strong_catalyst(symbol):
        score += 20
        reasons.append(f"Fresh {symbol.catalyst_type} catalyst")
    elif has_weak_catalyst(symbol):
        risk_warnings.append("No fresh catalyst or weak catalyst quality.")

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

    if symbol.spread_pct <= 1.5:
        score += 10
        reasons.append("Spread within liquidity threshold")
    else:
        risk_warnings.append("Spread is wider than the allowed threshold.")

    if symbol.holding_key_level:
        score += 10
        reasons.append("Holding key level")

    if symbol.no_dilution_red_flag:
        score += 5
        reasons.append("No obvious dilution red flag")
    else:
        risk_warnings.append("Dilution red flag present.")

    score = max(0, min(100, score))
    return {
        "score": score,
        "label": score_label(score),
        "reasons": reasons,
        "risk_warnings": risk_warnings,
    }
