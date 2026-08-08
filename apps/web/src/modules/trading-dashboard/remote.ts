import type { PlanDraft } from "@/lib/plan-preview";
import type { RiskRulesRemote } from "@/modules/trading-dashboard/risk/risk-rules-workspace";
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
  ScannerSession,
  ScannerSymbol,
  TradePlan,
  WatchlistItem,
} from "@/types/trading";
import type {
  AutomationDraft,
  CatalystDraft,
  JournalDraft,
  PromotionDraft,
} from "./contracts";

export type { RiskRulesRemote };

export type ScannerRemote = {
  listCandidates(): Promise<ScannerSymbol[]>;
  listSessions(): Promise<ScannerSession[]>;
  getSession(sessionId: number): Promise<ScannerSession>;
  importSampleCandidates(): Promise<ScannerSymbol[]>;
  startSession(): Promise<ScannerSession>;
  importCandidatesCsv(file: File): Promise<ScannerSymbol[]>;
  updateCandidateStatus(ticker: string, status: ScannerSymbol["status"]): Promise<ScannerSymbol>;
};

export type CandidateResearchRemote = {
  listCatalysts(): Promise<Catalyst[]>;
  createCatalystReview(draft: CatalystDraft): Promise<void>;
};

export type WatchlistRemote = {
  listItems(): Promise<WatchlistItem[]>;
  removeItem(ticker: string): Promise<void>;
  saveNotes(ticker: string, notes: string): Promise<WatchlistItem>;
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
