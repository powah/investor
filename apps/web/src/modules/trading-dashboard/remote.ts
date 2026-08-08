import type { CandidateResearchRemote } from "@/modules/trading-dashboard/candidate-research/candidate-research";
import type { AnalyticsRemote } from "@/modules/trading-dashboard/analytics/analytics-workspace";
import type { JournalRemote } from "@/modules/trading-dashboard/journal/journal-workspace";
import type { PlannerRemote } from "@/modules/trading-dashboard/planner/planner-workspace";
import type { RiskRulesRemote } from "@/modules/trading-dashboard/risk/risk-rules-workspace";
import type { ScannerRemote } from "@/modules/trading-dashboard/scanner/scanner-workspace";
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
  TradePlan,
  WatchlistItem,
} from "@/types/trading";
import type {
  AutomationDraft,
  PromotionDraft,
} from "./contracts";

export type { AnalyticsRemote, CandidateResearchRemote, JournalRemote, PlannerRemote, RiskRulesRemote, ScannerRemote };

export type WatchlistRemote = {
  listItems(): Promise<WatchlistItem[]>;
  removeItem(ticker: string): Promise<void>;
  saveNotes(ticker: string, notes: string): Promise<WatchlistItem>;
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
