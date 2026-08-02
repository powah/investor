import { describe, expect, test } from "vitest";
import { calculatePlanPreview, type PlanDraft } from "@/lib/plan-preview";
import { buildCandidate, buildRiskSettings, buildRiskState } from "@/test/fixtures";

const planningCandidate = buildCandidate();
const riskSettings = buildRiskSettings();
const openRiskState = buildRiskState();

function draft(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    plan_date: "2026-08-03",
    ticker: "ALFA",
    account_size: "25000",
    max_risk_per_trade_pct: "1",
    entry_price: "10",
    stop_price: "9.50",
    target_price: "11.50",
    ...overrides,
  };
}

describe("calculatePlanPreview", () => {
  test("sizes a worked long-momentum plan from its literal risk budget", () => {
    expect(calculatePlanPreview(draft(), planningCandidate, riskSettings, openRiskState)).toEqual({
      ready: true,
      blockers: [],
      warnings: [],
      riskPerShare: 0.5,
      cashRisk: 250,
      shares: 500,
      maxLoss: 250,
      rMultiple: 3,
    });
  });

  test("reports literal blockers and warnings for a constrained worked plan", () => {
    const constrainedSettings = buildRiskSettings({ max_position_shares: 40 });
    const constrainedRiskState = buildRiskState({
      trades_today: 4,
      daily_lockout: true,
    });
    const constrainedCandidate = buildCandidate({
      score: 50,
      spread_pct: 2,
      above_vwap: false,
    });

    expect(
      calculatePlanPreview(
        draft({ account_size: "10000", entry_price: "10", stop_price: "8", target_price: "9.50" }),
        constrainedCandidate,
        constrainedSettings,
        constrainedRiskState,
      ),
    ).toEqual({
      ready: true,
      blockers: [
        "Daily loss limit reached. New plans are locked out.",
        "Maximum trades for the day has been reached.",
        "Calculated size exceeds your 40 share limit.",
      ],
      warnings: [
        "Risk per share is more than 15% of entry.",
        "Target offers less than 1R of reward.",
        "Score is below your 65-point planning threshold.",
        "Spread is wider than your 1.5% limit.",
        "Ticker is below VWAP while VWAP confirmation is required.",
      ],
      riskPerShare: 2,
      cashRisk: 100,
      shares: 50,
      maxLoss: 100,
      rMultiple: -0.25,
    });
  });
});
