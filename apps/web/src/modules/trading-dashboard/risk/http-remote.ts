import { apiFetch } from "@/lib/api";
import { riskSettingsPayload, type RiskRulesRemote } from "@/modules/trading-dashboard/risk/risk-rules-workspace";
import type { RiskSettings, RiskState } from "@/types/trading";

export const httpRiskRulesRemote: RiskRulesRemote = {
  getSettings: () => apiFetch<RiskSettings>("/risk-settings"),
  getState: () => apiFetch<RiskState>("/risk-state"),
  updateSettings: (draft) =>
    apiFetch<RiskSettings>("/risk-settings", {
      method: "PUT",
      body: JSON.stringify(riskSettingsPayload(draft)),
    }),
};
