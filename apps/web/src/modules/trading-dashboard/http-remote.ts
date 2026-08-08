import { apiFetch } from "@/lib/api";
import type { PlanDraft } from "@/modules/trading-dashboard/planner/plan-preview";
import type {
  Analytics,
  AutomationRun,
  AutomationSettings,
  BrokerStreamState,
  BrokerSync,
  Catalyst,
  ExecutionAction,
  ExecutionIntent,
  ExternalNewsEvent,
  IntegrationsStatus,
  IntegrationSyncResult,
  JournalEntry,
  MarketDataSnapshot,
  RiskSettings,
  RiskState,
  ScannerSession,
  ScannerSymbol,
  TradePlan,
  WatchlistItem,
} from "@/types/trading";
import type {
  AutomationDraft,
  CatalystDraft,
  PromotionDraft,
} from "./contracts";
import type { JournalDraft } from "./journal/journal-workspace";
import { riskSettingsPayload } from "./risk/risk-rules-workspace";
import type { TradingDashboardRemote } from "./remote";

function optionalNumber(value: string) {
  return value.trim() === "" ? undefined : Number(value);
}

function catalystPayload(draft: CatalystDraft) {
  return {
    ...draft,
    ticker: draft.ticker.toUpperCase(),
    quality_score: Number(draft.quality_score),
  };
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

function journalEntryPayload(draft: JournalDraft) {
  return {
    trade_date: draft.trade_date,
    ticker: draft.ticker.toUpperCase(),
    setup: draft.setup,
    catalyst_type: draft.catalyst_type || null,
    entry_price: Number(draft.entry_price),
    stop_price: Number(draft.stop_price),
    exit_price: Number(draft.exit_price),
    shares: Number(draft.shares),
    pnl: optionalNumber(draft.pnl),
    notes: draft.notes || null,
    mistake_tags: draft.mistake_tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean),
    followed_plan: draft.followed_plan,
  };
}

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

export const httpTradingDashboardRemote: TradingDashboardRemote = {
  scanner: {
    listCandidates: () => apiFetch<ScannerSymbol[]>("/scanner"),
    listSessions: () => apiFetch<ScannerSession[]>("/scanner-sessions"),
    getSession: (sessionId) => apiFetch<ScannerSession>(`/scanner-sessions/${sessionId}`),
    importSampleCandidates: () => apiFetch<ScannerSymbol[]>("/scanner/import-sample", { method: "POST" }),
    startSession: () => apiFetch<ScannerSession>("/scanner-sessions", { method: "POST" }),
    importCandidatesCsv: (file) => {
      const body = new FormData();
      body.append("file", file);
      return apiFetch<ScannerSymbol[]>("/scanner/import-csv", { method: "POST", body });
    },
    updateCandidateStatus: (ticker, status) =>
      apiFetch<ScannerSymbol>(`/scanner/${encodeURIComponent(ticker)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
  },
  candidateResearch: {
    listCatalysts: () => apiFetch<Catalyst[]>("/catalysts"),
    createCatalystReview: (draft) =>
      apiFetch<void>("/catalysts", {
        method: "POST",
        body: JSON.stringify(catalystPayload(draft)),
      }),
  },
  watchlist: {
    listItems: () => apiFetch<WatchlistItem[]>("/watchlist"),
    removeItem: (ticker) =>
      apiFetch<void>(`/watchlist/${encodeURIComponent(ticker)}`, { method: "DELETE", emptyResponse: true }),
    saveNotes: (ticker, notes) =>
      apiFetch<WatchlistItem>("/watchlist", {
        method: "POST",
        body: JSON.stringify({ ticker, notes: notes || null }),
      }),
  },
  riskRules: {
    getSettings: () => apiFetch<RiskSettings>("/risk-settings"),
    getState: () => apiFetch<RiskState>("/risk-state"),
    updateSettings: (draft) =>
      apiFetch<RiskSettings>("/risk-settings", {
        method: "PUT",
        body: JSON.stringify(riskSettingsPayload(draft)),
      }),
  },
  planner: {
    listPlans: () => apiFetch<TradePlan[]>("/trade-plans"),
    createPlan: (draft) =>
      apiFetch<TradePlan>("/trade-plans", {
        method: "POST",
        body: JSON.stringify(tradePlanPayload(draft)),
      }),
  },
  journal: {
    listEntries: () => apiFetch<JournalEntry[]>("/journal"),
    createEntry: (draft) =>
      apiFetch<JournalEntry>("/journal", {
        method: "POST",
        body: JSON.stringify(journalEntryPayload(draft)),
      }),
  },
  analytics: {
    getSummary: () => apiFetch<Analytics>("/analytics"),
  },
  operations: {
    getIntegrationsStatus: () => apiFetch<IntegrationsStatus>("/integrations/status"),
    listMarketSnapshots: () => apiFetch<MarketDataSnapshot[]>("/integrations/market-data/snapshots"),
    listExternalEvents: () => apiFetch<ExternalNewsEvent[]>("/integrations/news-events"),
    getAutomationSettings: () => apiFetch<AutomationSettings>("/integrations/automation/settings"),
    listExecutions: () => apiFetch<Array<ExecutionIntent | ExecutionAction>>("/integrations/executions"),
    getBrokerStream: () => apiFetch<BrokerStreamState>("/integrations/broker/stream"),
    syncMarketData: () =>
      apiFetch<IntegrationSyncResult>("/integrations/market-data/sync", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    probeCapabilities: () => apiFetch<unknown[]>("/integrations/capabilities/probe", { method: "POST" }),
    syncNews: () =>
      apiFetch<IntegrationSyncResult>("/integrations/news/sync", {
        method: "POST",
        body: JSON.stringify({}),
      }),
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
        body: JSON.stringify({
          trade_plan_id: tradePlanId,
          order_type: "limit",
          time_in_force: "day",
        }),
      }),
    approveExecution: (executionId) =>
      apiFetch<ExecutionIntent | ExecutionAction>(`/integrations/executions/${executionId}/approve`, {
        method: "POST",
        body: JSON.stringify({ acknowledge_warnings: true }),
      }),
    submitExecution: (executionId) =>
      apiFetch<ExecutionIntent | ExecutionAction>(`/integrations/executions/${executionId}/submit`, { method: "POST" }),
    runAutomation: () => apiFetch<AutomationRun>("/integrations/automation/run", { method: "POST" }),
  },
};
