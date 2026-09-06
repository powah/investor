import type { AnalyticsRemote } from "@/modules/trading-dashboard/analytics/analytics-workspace";
import type { CandidateResearchRemote } from "@/modules/trading-dashboard/candidate-research/candidate-research";
import type { JournalRemote } from "@/modules/trading-dashboard/journal/journal-workspace";
import type { OperationsRemote } from "@/modules/trading-dashboard/operations-workspace";
import type { PlannerRemote } from "@/modules/trading-dashboard/planner/planner-workspace";
import type { RiskRulesRemote } from "@/modules/trading-dashboard/risk/risk-rules-workspace";
import type { ScannerRemote } from "@/modules/trading-dashboard/scanner/scanner-workspace";
import type { WatchlistRemote } from "@/modules/trading-dashboard/watchlist/watchlist-workspace";
import { buildCandidate, buildRiskSettings, buildRiskState } from "@/test/fixtures";
import type {
  Analytics,
  AutomationSettings,
  BrokerStreamState,
  IntegrationsStatus,
  TradePlan,
  WatchlistItem,
} from "@/types/trading";

const alfa = buildCandidate({ status: "watch" });

const beta = buildCandidate({
  id: 2,
  ticker: "BETA",
  price: 8.5,
  catalyst_type: "Contract",
  news_headline: "BETA wins a material contract",
  score: 74,
  label: "Tier B",
  status: "candidate",
});

const riskSettings = buildRiskSettings();
const riskState = buildRiskState();

const analytics: Analytics = {
  total_trades: 3,
  win_rate: 66.7,
  average_win: 150,
  average_loss: -75,
  net_pnl: 225,
  average_r: 1.25,
  best_catalyst_type: null,
  most_common_mistake: null,
};

function connection(purpose: string) {
  return {
    provider: "test",
    purpose,
    configured: true,
    enabled: true,
    environment: "paper",
    source_feed: "test",
    real_time: false,
    is_consolidated: false,
    verification_status: "available" as const,
    verified_at: "2026-08-03T12:00:00Z",
    verification_message: null,
    message: "Available",
  };
}

const integrationsStatus: IntegrationsStatus = {
  market_data: connection("market data"),
  news: connection("news"),
  filings: connection("filings"),
  broker: connection("broker"),
};

const automationSettings: AutomationSettings = {
  id: 1,
  enabled: false,
  auto_submit_approved: false,
  kill_switch_engaged: true,
  require_manual_approval: true,
  paper_only: true,
  max_orders_per_day: 2,
  max_order_notional: 1_000,
  max_quote_age_seconds: 15,
  max_price_deviation_pct: 1,
  allowed_order_types: ["limit"],
  updated_at: "2026-08-03T12:00:00Z",
};

const brokerStream: BrokerStreamState = {
  provider: "test",
  environment: "paper",
  status: "disabled",
  last_connected_at: null,
  last_disconnected_at: null,
  last_event_at: null,
  last_backfill_at: null,
  last_error: null,
  reconnect_count: 0,
  events_received: 0,
  events_processed: 0,
  duplicate_events: 0,
  updated_at: "2026-08-03T12:00:00Z",
};

const tradePlan: TradePlan = {
  id: 1,
  plan_date: "2026-08-03",
  ticker: "ALFA",
  account_size: 25_000,
  max_risk_per_trade_pct: 1,
  entry_price: 10,
  stop_price: 9.5,
  target_price: 11.5,
  risk_per_share: 0.5,
  shares: 500,
  max_loss: 250,
  r_multiple: 3,
  warnings: [],
  created_at: "2026-08-03T12:00:00Z",
};

export class InMemoryDashboardRemote {
  readonly requestedOperations: string[] = [];

  private result<T>(operation: string, value: T): Promise<T> {
    this.requestedOperations.push(operation);
    return Promise.resolve(value);
  }

  private unsupported(operation: string): Promise<never> {
    this.requestedOperations.push(operation);
    return Promise.reject(new Error(`No in-memory behavior for ${operation}`));
  }

  readonly scanner: ScannerRemote = {
    listCandidates: () => this.result("scanner.listCandidates", [alfa, beta]),
    listLegacyImports: () => this.result("scanner.listLegacyImports", []),
    getCurrentSession: () => this.result("scanner.getCurrentSession", null),
    cancelSession: () => Promise.reject(new Error("No active Scanner Session")),
    listSessions: () => this.result("scanner.listSessions", []),
    getSession: () => this.unsupported("scanner.getSession"),
    importSampleCandidates: () => this.unsupported("scanner.importSampleCandidates"),
    startSession: () => this.unsupported("scanner.startSession"),
    importCandidatesCsv: () => this.unsupported("scanner.importCandidatesCsv"),
    updateCandidateStatus: () => this.unsupported("scanner.updateCandidateStatus"),
  };

  readonly candidateResearch: CandidateResearchRemote = {
    listCatalysts: () => this.result("candidateResearch.listCatalysts", []),
    createCatalystReview: () => this.unsupported("candidateResearch.createCatalystReview"),
  };

  readonly watchlist: WatchlistRemote = {
    listItems: () =>
      this.result("watchlist.listItems", [
        {
          id: 1,
          ticker: "ALFA",
          notes: "Wait for support to hold.",
          created_at: "2026-08-03T12:00:00Z",
          symbol: alfa,
        } satisfies WatchlistItem,
      ]),
    removeItem: () => this.unsupported("watchlist.removeItem"),
    saveNotes: () => this.unsupported("watchlist.saveNotes"),
  };

  readonly riskRules: RiskRulesRemote = {
    getSettings: () => this.result("riskRules.getSettings", riskSettings),
    getState: () => this.result("riskRules.getState", riskState),
    updateSettings: () => this.unsupported("riskRules.updateSettings"),
  };

  readonly planner: PlannerRemote = {
    listPlans: () => this.result("planner.listPlans", [tradePlan]),
    createPlan: () => this.unsupported("planner.createPlan"),
  };

  readonly journal: JournalRemote = {
    listEntries: () => this.result("journal.listEntries", []),
    createEntry: () => this.unsupported("journal.createEntry"),
  };

  readonly analytics: AnalyticsRemote = {
    getSummary: () => this.result("analytics.getSummary", analytics),
  };

  readonly operations: OperationsRemote = {
    getIntegrationsStatus: () => this.result("operations.getIntegrationsStatus", integrationsStatus),
    listMarketSnapshots: () => this.result("operations.listMarketSnapshots", []),
    listExternalEvents: () => this.result("operations.listExternalEvents", []),
    getAutomationSettings: () => this.result("operations.getAutomationSettings", automationSettings),
    listExecutions: () => this.result("operations.listExecutions", []),
    getBrokerStream: () => this.result("operations.getBrokerStream", brokerStream),
    syncMarketData: () => this.unsupported("operations.syncMarketData"),
    probeCapabilities: () => this.unsupported("operations.probeCapabilities"),
    syncNews: () => this.unsupported("operations.syncNews"),
    promoteExternalEvent: () => this.unsupported("operations.promoteExternalEvent"),
    updateAutomationSettings: () => this.unsupported("operations.updateAutomationSettings"),
    updateKillSwitch: () => this.unsupported("operations.updateKillSwitch"),
    syncBroker: () => this.unsupported("operations.syncBroker"),
    prepareExecution: () => this.unsupported("operations.prepareExecution"),
    approveExecution: () => this.unsupported("operations.approveExecution"),
    submitExecution: () => this.unsupported("operations.submitExecution"),
    runAutomation: () => this.unsupported("operations.runAutomation"),
  };
}
