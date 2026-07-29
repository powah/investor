export type ScannerSymbol = {
  id: number;
  ticker: string;
  price: number;
  gap_pct: number;
  rel_volume: number;
  float_m: number;
  market_cap_m: number;
  spread_pct: number;
  catalyst_type: string | null;
  above_vwap: boolean;
  news_headline: string | null;
  clean_daily_chart_room: boolean;
  holding_key_level: boolean;
  no_dilution_red_flag: boolean;
  status: "candidate" | "watch" | "ignore";
  data_origin: string;
  score: number;
  label: string;
  reasons: string[];
  risk_warnings: string[];
  latest_catalyst_quality_score: number | null;
  latest_catalyst_published_time: string | null;
  latest_catalyst_is_fresh: boolean;
  created_at: string;
  updated_at: string;
};

export type WatchlistItem = {
  id: number;
  ticker: string;
  notes: string | null;
  created_at: string;
  symbol: ScannerSymbol | null;
};

export type Catalyst = {
  id: number;
  ticker: string;
  published_time: string;
  source: string;
  headline: string;
  catalyst_type: string;
  quality_score: number;
  created_at: string;
};

export type RiskSettings = {
  id: number;
  account_size: number;
  max_risk_per_trade_pct: number;
  max_daily_loss: number;
  max_trades_per_day: number;
  max_consecutive_losses: number;
  allowed_start_time: string;
  allowed_end_time: string;
  min_score_to_plan: number;
  max_spread_pct: number;
  max_position_shares: number;
  require_above_vwap: boolean;
  updated_at: string;
};

export type TradePlan = {
  id: number;
  plan_date: string;
  ticker: string;
  account_size: number;
  max_risk_per_trade_pct: number;
  entry_price: number;
  stop_price: number;
  target_price: number | null;
  risk_per_share: number;
  shares: number;
  max_loss: number;
  r_multiple: number | null;
  warnings: string[];
  created_at: string;
};

export type JournalEntry = {
  id: number;
  trade_date: string;
  ticker: string;
  setup: string;
  catalyst_type: string | null;
  entry_price: number;
  stop_price: number;
  exit_price: number;
  shares: number;
  pnl: number;
  r_multiple: number;
  notes: string | null;
  mistake_tags: string[];
  followed_plan: boolean;
  created_at: string;
};

export type Analytics = {
  total_trades: number;
  win_rate: number;
  average_win: number;
  average_loss: number;
  net_pnl: number;
  average_r: number;
  best_catalyst_type: string | null;
  most_common_mistake: string | null;
};

export type RiskState = {
  date: string;
  daily_realized_pnl: number;
  daily_loss_remaining: number;
  trades_today: number;
  max_trades_per_day: number;
  daily_lockout: boolean;
};

export type ProviderConnectionStatus = {
  provider: string;
  purpose: string;
  configured: boolean;
  enabled: boolean;
  environment: string;
  source_feed: string | null;
  real_time: boolean;
  is_consolidated: boolean;
  verification_status: "not_tested" | "available" | "unavailable" | "failed";
  verified_at: string | null;
  verification_message: string | null;
  message: string;
};

export type IntegrationsStatus = {
  market_data: ProviderConnectionStatus;
  news: ProviderConnectionStatus;
  filings: ProviderConnectionStatus;
  broker: ProviderConnectionStatus;
};

export type MarketDataSnapshot = {
  id: number;
  ticker: string;
  provider: string;
  source_feed: string;
  price: number;
  bid: number | null;
  ask: number | null;
  spread_pct: number | null;
  volume: number | null;
  vwap: number | null;
  previous_close: number | null;
  event_time: string;
  observed_at: string;
  delay_seconds: number | null;
  is_consolidated: boolean;
  request_id: string | null;
};

export type ExternalNewsEvent = {
  id: number;
  provider: string;
  external_id: string;
  ticker: string;
  source: string;
  category: string | null;
  headline: string;
  summary: string | null;
  url: string | null;
  published_at: string;
  updated_at_external: string | null;
  observed_at: string;
  promoted_catalyst_id: number | null;
};

export type IntegrationSyncProviderResult = {
  provider: string;
  status: "completed" | "failed" | "skipped";
  records_count: number;
  message: string | null;
};

export type IntegrationSyncResult = {
  results: IntegrationSyncProviderResult[];
  snapshots: MarketDataSnapshot[];
  news_events: ExternalNewsEvent[];
};

export type MarketDataSyncRequest = {
  symbols?: string[];
  feed?: "delayed_sip" | "iex" | "sip";
};

export type NewsSyncRequest = {
  symbols?: string[];
  providers?: Array<"alpaca" | "sec">;
  since_hours?: number;
  limit?: number;
};

export type PromoteNewsEventRequest = {
  catalyst_type: string;
  quality_score: number;
};

export type AutomationSettings = {
  id: number;
  enabled: boolean;
  auto_submit_approved: boolean;
  kill_switch_engaged: boolean;
  require_manual_approval: boolean;
  paper_only: boolean;
  max_orders_per_day: number;
  max_order_notional: number;
  max_quote_age_seconds: number;
  max_price_deviation_pct: number;
  allowed_order_types: string[];
  updated_at: string;
};

export type AutomationSettingsUpdate = Partial<
  Pick<
    AutomationSettings,
    | "enabled"
    | "auto_submit_approved"
    | "require_manual_approval"
    | "max_orders_per_day"
    | "max_order_notional"
    | "max_quote_age_seconds"
    | "max_price_deviation_pct"
  >
>;

export type KillSwitchUpdate = {
  engaged: boolean;
  confirmation: string;
};

export type ExecutionIntentCreate = {
  trade_plan_id: number;
  order_type: "limit";
  time_in_force: "day";
};

export type ExecutionApprovalRequest = {
  acknowledge_warnings: true;
  approval_note?: string;
};

export type ExecutionIntentStatus =
  | "draft"
  | "prepared"
  | "blocked"
  | "pending_approval"
  | "approved"
  | "submitting"
  | "submission_unknown"
  | "submitted"
  | "accepted"
  | "partially_filled"
  | "entry_filled_protected"
  | "protection_failed"
  | "filled"
  | "canceled"
  | "expired"
  | "done_for_day"
  | "replaced"
  | "rejected"
  | "failed";

export type ExecutionIntent = {
  id: number;
  trade_plan_id: number;
  broker_provider: string;
  status: ExecutionIntentStatus;
  order_type: string;
  time_in_force: string;
  quantity: number;
  limit_price: number;
  stop_price: number;
  target_price: number | null;
  client_order_id: string;
  broker_order_id: string | null;
  approval_note: string | null;
  approved_at: string | null;
  submitted_at: string | null;
  last_reconciled_at: string | null;
  failure_reason: string | null;
  risk_snapshot: Record<string, unknown>;
  quote_snapshot: Record<string, unknown>;
  request_payload: Record<string, unknown>;
  broker_payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ExecutionAction = {
  intent: ExecutionIntent;
  blockers: string[];
  warnings: string[];
};

export type BrokerAccount = {
  provider: string;
  environment: string;
  account_id: string;
  status: string;
  currency: string | null;
  buying_power: number | null;
  cash: number | null;
  equity: number | null;
  trading_blocked: boolean;
  account_blocked: boolean;
  trade_suspended_by_user: boolean;
};

export type BrokerClock = {
  provider: string;
  timestamp: string;
  is_open: boolean;
  next_open: string;
  next_close: string;
};

export type BrokerPosition = {
  provider: string;
  symbol: string;
  quantity: number;
  available_quantity: number | null;
  side: string;
  average_entry_price: number | null;
  current_price: number | null;
  market_value: number | null;
  unrealized_pl: number | null;
};

export type BrokerOrder = {
  provider: string;
  id: string;
  client_order_id: string;
  symbol: string;
  side: string;
  order_type: string;
  time_in_force: string;
  status: string;
  quantity: number | null;
  filled_quantity: number;
  filled_average_price: number | null;
  limit_price: number | null;
  stop_price: number | null;
  submitted_at: string | null;
  updated_at: string | null;
  raw: Record<string, unknown>;
};

export type BrokerSync = {
  account: BrokerAccount;
  clock: BrokerClock;
  positions: BrokerPosition[];
  orders: BrokerOrder[];
};

export type BrokerStreamState = {
  provider: string;
  environment: string;
  status: "starting" | "disabled" | "connecting" | "listening" | "reconnecting" | "error" | string;
  last_connected_at: string | null;
  last_disconnected_at: string | null;
  last_event_at: string | null;
  last_backfill_at: string | null;
  last_error: string | null;
  reconnect_count: number;
  events_received: number;
  events_processed: number;
  duplicate_events: number;
  updated_at: string;
};

export type AutomationRun = {
  processed: number;
  submitted: number;
  reconciled: number;
  failed: number;
};
