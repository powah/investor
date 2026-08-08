export type CatalystDraft = {
  ticker: string;
  published_time: string;
  source: string;
  headline: string;
  catalyst_type: string;
  quality_score: string;
};

export type JournalDraft = {
  trade_date: string;
  ticker: string;
  setup: string;
  catalyst_type: string;
  entry_price: string;
  stop_price: string;
  exit_price: string;
  shares: string;
  pnl: string;
  notes: string;
  mistake_tags: string;
  followed_plan: boolean;
};

export type RiskDraft = {
  account_size: string;
  max_risk_per_trade_pct: string;
  max_daily_loss: string;
  max_trades_per_day: string;
  max_consecutive_losses: string;
  allowed_start_time: string;
  allowed_end_time: string;
  min_score_to_plan: string;
  max_spread_pct: string;
  max_position_shares: string;
  require_above_vwap: boolean;
};

export type AutomationDraft = {
  enabled: boolean;
  auto_submit_approved: boolean;
  require_manual_approval: boolean;
  max_orders_per_day: string;
  max_order_notional: string;
  max_quote_age_seconds: string;
  max_price_deviation_pct: string;
};

export type PromotionDraft = {
  catalyst_type: string;
  quality_score: string;
};
