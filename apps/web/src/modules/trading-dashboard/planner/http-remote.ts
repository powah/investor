import { apiFetch } from "@/lib/api";
import type { PlanDraft } from "@/modules/trading-dashboard/planner/plan-preview";
import type { PlannerRemote } from "@/modules/trading-dashboard/planner/planner-workspace";
import type { TradePlan } from "@/types/trading";

function optionalNumber(value: string) {
  return value.trim() === "" ? undefined : Number(value);
}

function tradePlanPayload(draft: PlanDraft) {
  return {
    plan_date: draft.plan_date,
    ticker: draft.ticker.toUpperCase(),
    account_size: optionalNumber(draft.account_size),
    max_risk_per_trade_pct: optionalNumber(draft.max_risk_per_trade_pct),
    entry_price: Number(draft.entry_price),
    stop_price: optionalNumber(draft.stop_price),
    target_price: optionalNumber(draft.target_price),
  };
}

export const httpPlannerRemote: PlannerRemote = {
  listPlans: () => apiFetch<TradePlan[]>("/trade-plans"),
  createPlan: (draft) =>
    apiFetch<TradePlan>("/trade-plans", {
      method: "POST",
      body: JSON.stringify(tradePlanPayload(draft)),
    }),
};
