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
  score: number;
  label: string;
  reasons: string[];
  risk_warnings: string[];
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
