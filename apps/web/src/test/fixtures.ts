import type { RiskSettings, RiskState, ScannerSymbol } from "@/types/trading";

export function buildCandidate(overrides: Partial<ScannerSymbol> = {}): ScannerSymbol {
  return {
    id: 1,
    ticker: "ALFA",
    price: 10,
    gap_pct: 24,
    rel_volume: 5.2,
    float_m: 12,
    market_cap_m: 480,
    spread_pct: 0.6,
    catalyst_type: "FDA",
    above_vwap: true,
    news_headline: "ALFA reports a clinical milestone",
    clean_daily_chart_room: true,
    holding_key_level: true,
    no_dilution_red_flag: true,
    status: "candidate",
    data_origin: "test",
    score: 82,
    label: "Tier A",
    reasons: ["Fresh reviewed catalyst"],
    risk_warnings: [],
    latest_catalyst_quality_score: 18,
    latest_catalyst_published_time: "2026-08-03T12:00:00Z",
    latest_catalyst_is_fresh: true,
    created_at: "2026-08-03T12:00:00Z",
    updated_at: "2026-08-03T12:00:00Z",
    ...overrides,
  };
}

export function buildRiskSettings(overrides: Partial<RiskSettings> = {}): RiskSettings {
  return {
    id: 1,
    account_size: 25_000,
    max_risk_per_trade_pct: 1,
    max_daily_loss: 500,
    max_trades_per_day: 4,
    max_consecutive_losses: 2,
    allowed_start_time: "09:35:00",
    allowed_end_time: "15:30:00",
    min_score_to_plan: 65,
    max_spread_pct: 1.5,
    max_position_shares: 10_000,
    require_above_vwap: true,
    updated_at: "2026-08-03T12:00:00Z",
    ...overrides,
  };
}

export function buildRiskState(overrides: Partial<RiskState> = {}): RiskState {
  return {
    date: "2026-08-03",
    daily_realized_pnl: 0,
    daily_loss_remaining: 500,
    trades_today: 0,
    max_trades_per_day: 4,
    daily_lockout: false,
    ...overrides,
  };
}
