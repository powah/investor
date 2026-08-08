import type { CandidateResearchRemote } from "@/modules/trading-dashboard/candidate-research/candidate-research";
import type { AnalyticsRemote } from "@/modules/trading-dashboard/analytics/analytics-workspace";
import type { JournalRemote } from "@/modules/trading-dashboard/journal/journal-workspace";
import type { PlannerRemote } from "@/modules/trading-dashboard/planner/planner-workspace";
import type { RiskRulesRemote } from "@/modules/trading-dashboard/risk/risk-rules-workspace";
import type { ScannerRemote } from "@/modules/trading-dashboard/scanner/scanner-workspace";
import type { TradePlan, WatchlistItem } from "@/types/trading";
import type { AutomationRemote } from "./operations/automation";
import type { ConnectionStatusRemote } from "./operations/connection-status";
import type { DataFeedRemote } from "./operations/data-feeds";
import type { EventReviewRemote } from "./operations/event-review";
import type { PaperExecutionRemote } from "./operations/paper-execution";

export type { AnalyticsRemote, CandidateResearchRemote, JournalRemote, PlannerRemote, RiskRulesRemote, ScannerRemote };

export type WatchlistRemote = {
  listItems(): Promise<WatchlistItem[]>;
  removeItem(ticker: string): Promise<void>;
  saveNotes(ticker: string, notes: string): Promise<WatchlistItem>;
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
