import { number } from "@/lib/api";
import type { RiskSettings, RiskState, ScannerSymbol } from "@/types/trading";

export type PlanPreview = {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  riskPerShare: number;
  cashRisk: number;
  shares: number;
  maxLoss: number;
  rMultiple: number | null;
};

export type PlanDraft = {
  plan_date: string;
  ticker: string;
  account_size: string;
  max_risk_per_trade_pct: string;
  entry_price: string;
  stop_price: string;
  target_price: string;
};

function optionalNumber(value: string) {
  return value.trim() === "" ? undefined : Number(value);
}

export function calculatePlanPreview(
  draft: PlanDraft,
  symbol: ScannerSymbol | null,
  settings: RiskSettings | null,
  riskState: RiskState | null,
): PlanPreview {
  const entry = optionalNumber(draft.entry_price);
  const stop = optionalNumber(draft.stop_price);
  const target = optionalNumber(draft.target_price);
  const accountSize = optionalNumber(draft.account_size) ?? settings?.account_size;
  const riskPct = optionalNumber(draft.max_risk_per_trade_pct) ?? settings?.max_risk_per_trade_pct;
  const ready = Boolean(draft.ticker && entry && stop && accountSize && riskPct);
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!ready) {
    return { ready: false, blockers, warnings, riskPerShare: 0, cashRisk: 0, shares: 0, maxLoss: 0, rMultiple: null };
  }

  if (!entry || !stop || !accountSize || !riskPct) {
    return { ready: false, blockers, warnings, riskPerShare: 0, cashRisk: 0, shares: 0, maxLoss: 0, rMultiple: null };
  }

  if (stop >= entry) {
    blockers.push("Stop must be below entry for this long momentum setup.");
  }
  if (riskState?.daily_lockout) {
    blockers.push("Daily loss limit reached. New plans are locked out.");
  }
  if (riskState && riskState.trades_today >= riskState.max_trades_per_day) {
    blockers.push("Maximum trades for the day has been reached.");
  }

  const riskPerShare = Math.max(0, Math.round((entry - stop) * 10_000) / 10_000);
  const cashRisk = Math.round(accountSize * (riskPct / 100) * 100) / 100;
  const shares = riskPerShare > 0 ? Math.floor((cashRisk + Number.EPSILON) / riskPerShare) : 0;
  const maxLoss = Math.round(shares * riskPerShare * 100) / 100;
  const rMultiple = target && riskPerShare > 0 ? (target - entry) / riskPerShare : null;

  if (riskPerShare > 0 && riskPerShare / entry > 0.15) {
    warnings.push("Risk per share is more than 15% of entry.");
  }
  if (settings && shares > settings.max_position_shares) {
    blockers.push(`Calculated size exceeds your ${number(settings.max_position_shares, 0)} share limit.`);
  }
  if (rMultiple !== null && rMultiple < 1) {
    warnings.push("Target offers less than 1R of reward.");
  }
  if (!symbol) {
    warnings.push("Ticker is not in the current scanner universe.");
  } else if (settings) {
    if (symbol.score < settings.min_score_to_plan) {
      warnings.push(`Score is below your ${settings.min_score_to_plan}-point planning threshold.`);
    }
    if (symbol.spread_pct > settings.max_spread_pct) {
      warnings.push(`Spread is wider than your ${number(settings.max_spread_pct, 1)}% limit.`);
    }
    if (!symbol.latest_catalyst_is_fresh) {
      warnings.push("No catalyst inside the 72-hour freshness window is recorded.");
    }
    if (settings.require_above_vwap && !symbol.above_vwap) {
      warnings.push("Ticker is below VWAP while VWAP confirmation is required.");
    }
  }

  return {
    ready,
    blockers,
    warnings,
    riskPerShare,
    cashRisk,
    shares,
    maxLoss,
    rMultiple,
  };
}
