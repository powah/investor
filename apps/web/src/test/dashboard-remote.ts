import type { RemoteSystem, RemoteRequestOptions } from "@/lib/remote-system";
import { buildCandidate, buildRiskSettings, buildRiskState } from "@/test/fixtures";
import type {
  Analytics,
  AutomationSettings,
  BrokerStreamState,
  IntegrationsStatus,
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
  total_trades: 0,
  win_rate: 0,
  average_win: 0,
  average_loss: 0,
  net_pnl: 0,
  average_r: 0,
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

export class InMemoryDashboardRemote implements RemoteSystem {
  readonly requestedPaths: string[] = [];

  private readonly responses: Record<string, unknown> = {
    "/scanner": [alfa, beta],
    "/scanner-sessions": [],
    "/watchlist": [
      {
        id: 1,
        ticker: "ALFA",
        notes: "Wait for support to hold.",
        created_at: "2026-08-03T12:00:00Z",
        symbol: alfa,
      } satisfies WatchlistItem,
    ],
    "/catalysts": [],
    "/risk-settings": riskSettings,
    "/risk-state": riskState,
    "/trade-plans": [],
    "/journal": [],
    "/analytics": analytics,
    "/integrations/status": integrationsStatus,
    "/integrations/market-data/snapshots": [],
    "/integrations/news-events": [],
    "/integrations/automation/settings": automationSettings,
    "/integrations/executions": [],
    "/integrations/broker/stream": brokerStream,
  };

  request = async <T>(path: string, _options: RemoteRequestOptions = {}): Promise<T> => {
    this.requestedPaths.push(path);
    if (!(path in this.responses)) {
      throw new Error(`No in-memory response for ${path}`);
    }
    return this.responses[path] as T;
  };
}
