import { describe, expect, test } from "vitest";
import { riskSettingsPayload, type RiskDraft } from "@/modules/trading-dashboard/risk/risk-rules-workspace";

describe("riskSettingsPayload", () => {
  test("preserves the Risk Rules validation payload contract", () => {
    const draft: RiskDraft = {
      account_size: "30000",
      max_risk_per_trade_pct: "0.75",
      max_daily_loss: "450",
      max_trades_per_day: "3",
      max_consecutive_losses: "2",
      allowed_start_time: "09:35",
      allowed_end_time: "15:30",
      min_score_to_plan: "70",
      max_spread_pct: "1.25",
      max_position_shares: "8000",
      require_above_vwap: true,
    };

    expect(riskSettingsPayload(draft)).toEqual({
      account_size: 30000,
      max_risk_per_trade_pct: 0.75,
      max_daily_loss: 450,
      max_trades_per_day: 3,
      max_consecutive_losses: 2,
      allowed_start_time: "09:35",
      allowed_end_time: "15:30",
      min_score_to_plan: 70,
      max_spread_pct: 1.25,
      max_position_shares: 8000,
      require_above_vwap: true,
    });
  });
});
