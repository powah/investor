import { httpAnalyticsRemote } from "@/modules/trading-dashboard/analytics/http-remote";
import { httpCandidateResearchRemote } from "@/modules/trading-dashboard/candidate-research/http-remote";
import { httpJournalRemote } from "@/modules/trading-dashboard/journal/http-remote";
import { httpOperationsRemote } from "@/modules/trading-dashboard/operations/http-remote";
import { httpPlannerRemote } from "@/modules/trading-dashboard/planner/http-remote";
import { httpRiskRulesRemote } from "@/modules/trading-dashboard/risk/http-remote";
import { httpScannerRemote } from "@/modules/trading-dashboard/scanner/http-remote";
import { httpWatchlistRemote } from "@/modules/trading-dashboard/watchlist/http-remote";

export const httpTradingDashboard = {
  scanner: httpScannerRemote,
  candidateResearch: httpCandidateResearchRemote,
  watchlist: httpWatchlistRemote,
  riskRules: httpRiskRulesRemote,
  planner: httpPlannerRemote,
  journal: httpJournalRemote,
  analytics: httpAnalyticsRemote,
  operations: httpOperationsRemote,
};
