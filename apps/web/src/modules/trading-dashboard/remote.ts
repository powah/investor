import type { CandidateResearchRemote } from "@/modules/trading-dashboard/candidate-research/candidate-research";
import type { AnalyticsRemote } from "@/modules/trading-dashboard/analytics/analytics-workspace";
import type { JournalRemote } from "@/modules/trading-dashboard/journal/journal-workspace";
import type { AutomationRemote } from "@/modules/trading-dashboard/operations/automation";
import type { ConnectionStatusRemote } from "@/modules/trading-dashboard/operations/connection-status";
import type { DataFeedRemote } from "@/modules/trading-dashboard/operations/data-feeds";
import type { EventReviewRemote } from "@/modules/trading-dashboard/operations/event-review";
import type { PaperExecutionRemote } from "@/modules/trading-dashboard/operations/paper-execution";
import type { PlannerRemote } from "@/modules/trading-dashboard/planner/planner-workspace";
import type { RiskRulesRemote } from "@/modules/trading-dashboard/risk/risk-rules-workspace";
import type { ScannerRemote } from "@/modules/trading-dashboard/scanner/scanner-workspace";
import type { WatchlistRemote } from "@/modules/trading-dashboard/watchlist/watchlist-workspace";

export type { AnalyticsRemote, CandidateResearchRemote, JournalRemote, PlannerRemote, RiskRulesRemote, ScannerRemote, WatchlistRemote };

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
