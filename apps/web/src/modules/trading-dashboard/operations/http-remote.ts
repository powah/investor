import { apiFetch } from "@/lib/api";
import type { OperationsRemote } from "@/modules/trading-dashboard/operations-workspace";
import type { AutomationDraft } from "@/modules/trading-dashboard/operations/automation";
import type {
  AutomationRun,
  AutomationSettings,
  BrokerStreamState,
  BrokerSync,
  ExecutionAction,
  ExecutionIntent,
  ExternalNewsEvent,
  IntegrationsStatus,
  IntegrationSyncResult,
  MarketDataSnapshot,
} from "@/types/trading";

function automationSettingsPayload(draft: AutomationDraft) {
  return {
    enabled: draft.enabled,
    auto_submit_approved: draft.auto_submit_approved,
    require_manual_approval: draft.require_manual_approval,
    max_orders_per_day: Number(draft.max_orders_per_day),
    max_order_notional: Number(draft.max_order_notional),
    max_quote_age_seconds: Number(draft.max_quote_age_seconds),
    max_price_deviation_pct: Number(draft.max_price_deviation_pct),
  };
}

export const httpOperationsRemote: OperationsRemote = {
  getIntegrationsStatus: () => apiFetch<IntegrationsStatus>("/integrations/status"),
  listMarketSnapshots: () => apiFetch<MarketDataSnapshot[]>("/integrations/market-data/snapshots"),
  listExternalEvents: () => apiFetch<ExternalNewsEvent[]>("/integrations/news-events"),
  getAutomationSettings: () => apiFetch<AutomationSettings>("/integrations/automation/settings"),
  listExecutions: () => apiFetch<Array<ExecutionIntent | ExecutionAction>>("/integrations/executions"),
  getBrokerStream: () => apiFetch<BrokerStreamState>("/integrations/broker/stream"),
  syncMarketData: () => apiFetch<IntegrationSyncResult>("/integrations/market-data/sync", { method: "POST", body: JSON.stringify({}) }),
  probeCapabilities: () => apiFetch<unknown[]>("/integrations/capabilities/probe", { method: "POST" }),
  syncNews: () => apiFetch<IntegrationSyncResult>("/integrations/news/sync", { method: "POST", body: JSON.stringify({}) }),
  promoteExternalEvent: (eventId, draft) =>
    apiFetch<ExternalNewsEvent>(`/integrations/news-events/${eventId}/promote`, {
      method: "POST",
      body: JSON.stringify({
        catalyst_type: draft.catalyst_type.trim(),
        quality_score: Number(draft.quality_score),
      }),
    }),
  updateAutomationSettings: (draft) =>
    apiFetch<AutomationSettings>("/integrations/automation/settings", {
      method: "PUT",
      body: JSON.stringify(automationSettingsPayload(draft)),
    }),
  updateKillSwitch: (engaged, confirmation) =>
    apiFetch<AutomationSettings>("/integrations/automation/kill-switch", {
      method: "POST",
      body: JSON.stringify({ engaged, confirmation: engaged ? "" : confirmation }),
    }),
  syncBroker: () => apiFetch<BrokerSync>("/integrations/broker/sync"),
  prepareExecution: (tradePlanId) =>
    apiFetch<ExecutionIntent | ExecutionAction>("/integrations/executions", {
      method: "POST",
      body: JSON.stringify({ trade_plan_id: tradePlanId, order_type: "limit", time_in_force: "day" }),
    }),
  approveExecution: (executionId) =>
    apiFetch<ExecutionIntent | ExecutionAction>(`/integrations/executions/${executionId}/approve`, {
      method: "POST",
      body: JSON.stringify({ acknowledge_warnings: true }),
    }),
  submitExecution: (executionId) => apiFetch<ExecutionIntent | ExecutionAction>(`/integrations/executions/${executionId}/submit`, { method: "POST" }),
  runAutomation: () => apiFetch<AutomationRun>("/integrations/automation/run", { method: "POST" }),
};
