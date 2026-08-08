import type { PlanDraft } from "@/lib/plan-preview";
import type { CandidateResearchRemote } from "@/modules/trading-dashboard/candidate-research/candidate-research";
import type { ScannerRemote } from "@/modules/trading-dashboard/scanner/scanner-workspace";
import type {
  Analytics,
  AutomationRun,
  AutomationSettings,
  BrokerStreamState,
  BrokerSync,
  ExecutionAction,
  ExecutionIntent,
  ExternalNewsEvent,
  IntegrationsStatus,
  IntegrationSyncResult,
  JournalEntry,
  MarketDataSnapshot,
  RiskSettings,
  RiskState,
  TradePlan,
  WatchlistItem,
} from "@/types/trading";
import type {
  AutomationDraft,
  JournalDraft,
  PromotionDraft,
  RiskDraft,
} from "./contracts";

export type { CandidateResearchRemote, ScannerRemote };

export type WatchlistRemote = {
  listItems(): Promise<WatchlistItem[]>;
  removeItem(ticker: string): Promise<void>;
  saveNotes(ticker: string, notes: string): Promise<WatchlistItem>;
};

export type RiskRulesRemote = {
  getSettings(): Promise<RiskSettings>;
  getState(): Promise<RiskState>;
  updateSettings(draft: RiskDraft): Promise<RiskSettings>;
};

export type PlannerRemote = {
  listPlans(): Promise<TradePlan[]>;
  createPlan(draft: PlanDraft): Promise<TradePlan>;
};

export type JournalRemote = {
  listEntries(): Promise<JournalEntry[]>;
  createEntry(draft: JournalDraft): Promise<JournalEntry>;
};

export type AnalyticsRemote = {
  getSummary(): Promise<Analytics>;
};

export type OperationsRemote = {
  getIntegrationsStatus(): Promise<IntegrationsStatus>;
  listMarketSnapshots(): Promise<MarketDataSnapshot[]>;
  listExternalEvents(): Promise<ExternalNewsEvent[]>;
  getAutomationSettings(): Promise<AutomationSettings>;
  listExecutions(): Promise<Array<ExecutionIntent | ExecutionAction>>;
  getBrokerStream(): Promise<BrokerStreamState>;
  syncMarketData(): Promise<IntegrationSyncResult>;
  probeCapabilities(): Promise<unknown[]>;
  syncNews(): Promise<IntegrationSyncResult>;
  promoteExternalEvent(eventId: number, draft: PromotionDraft): Promise<ExternalNewsEvent>;
  updateAutomationSettings(draft: AutomationDraft): Promise<AutomationSettings>;
  updateKillSwitch(engaged: boolean, confirmation: string): Promise<AutomationSettings>;
  syncBroker(): Promise<BrokerSync>;
  prepareExecution(tradePlanId: number): Promise<ExecutionIntent | ExecutionAction>;
  approveExecution(executionId: number): Promise<ExecutionIntent | ExecutionAction>;
  submitExecution(executionId: number): Promise<ExecutionIntent | ExecutionAction>;
  runAutomation(): Promise<AutomationRun>;
};

export type TradingDashboardRemote = {
  scanner: ScannerRemote;
  candidateResearch: CandidateResearchRemote;
  watchlist: WatchlistRemote;
  riskRules: RiskRulesRemote;
  planner: PlannerRemote;
  journal: JournalRemote;
  analytics: AnalyticsRemote;
  operations: OperationsRemote;
};
