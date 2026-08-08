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
