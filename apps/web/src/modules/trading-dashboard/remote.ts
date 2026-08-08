import type { PlanDraft } from "@/lib/plan-preview";
import type {
  Analytics,
  Catalyst,
  JournalEntry,
  RiskSettings,
  RiskState,
  ScannerSession,
  ScannerSymbol,
  TradePlan,
  WatchlistItem,
} from "@/types/trading";
import type {
  CatalystDraft,
  JournalDraft,
  RiskDraft,
} from "./contracts";
import type { AutomationRemote } from "./operations/automation";
import type { ConnectionStatusRemote } from "./operations/connection-status";
import type { DataFeedRemote } from "./operations/data-feeds";
import type { EventReviewRemote } from "./operations/event-review";
import type { PaperExecutionRemote } from "./operations/paper-execution";

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
