import type { PlanDraft } from "@/lib/plan-preview";
import type { CandidateResearchRemote } from "@/modules/trading-dashboard/candidate-research/candidate-research";
import type { ScannerRemote } from "@/modules/trading-dashboard/scanner/scanner-workspace";
import type {
  Analytics,
  JournalEntry,
  RiskSettings,
  RiskState,
  TradePlan,
  WatchlistItem,
} from "@/types/trading";
import type { JournalDraft, RiskDraft } from "./contracts";
import type { AutomationRemote } from "./operations/automation";
import type { ConnectionStatusRemote } from "./operations/connection-status";
import type { DataFeedRemote } from "./operations/data-feeds";
import type { EventReviewRemote } from "./operations/event-review";
import type { PaperExecutionRemote } from "./operations/paper-execution";

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

export type OperationsRemote = ConnectionStatusRemote &
  DataFeedRemote &
  EventReviewRemote &
  AutomationRemote &
  PaperExecutionRemote;

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
