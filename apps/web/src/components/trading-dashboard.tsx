"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BookOpen,
  Calculator,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Eye,
  EyeOff,
  LayoutDashboard,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Settings,
  Trash2,
  Upload,
} from "lucide-react";
import { EquityChart } from "@/components/equity-chart";
import { ApiError, apiFetch, currency, number, todayIsoDate } from "@/lib/api";
import type {
  Analytics,
  Catalyst,
  JournalEntry,
  RiskSettings,
  RiskState,
  ScannerSymbol,
  TradePlan,
  WatchlistItem,
} from "@/types/trading";

type WorkspaceView = "scanner" | "watchlist" | "planner" | "journal" | "analytics" | "settings";
type ScannerFilter = "all" | "qualified" | "watching" | "caution";

type PlanPreview = {
  ready: boolean;
  blockers: string[];
  warnings: string[];
  riskPerShare: number;
  cashRisk: number;
  shares: number;
  maxLoss: number;
  rMultiple: number | null;
};

type CatalystDraft = {
  ticker: string;
  published_time: string;
  source: string;
  headline: string;
  catalyst_type: string;
  quality_score: string;
};

type PlanDraft = {
  plan_date: string;
  ticker: string;
  account_size: string;
  max_risk_per_trade_pct: string;
  entry_price: string;
  stop_price: string;
  target_price: string;
};

type JournalDraft = {
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

type RiskDraft = {
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

const emptyAnalytics: Analytics = {
  total_trades: 0,
  win_rate: 0,
  average_win: 0,
  average_loss: 0,
  net_pnl: 0,
  average_r: 0,
  best_catalyst_type: null,
  most_common_mistake: null,
};

function apiMessage(error: unknown) {
  if (error instanceof ApiError) {
    const details = error.details as
      | {
          detail?:
            | string
            | {
                blockers?: string[];
                warnings?: string[];
                message?: string;
                errors?: Array<{ row?: number | null; field?: string; message?: string }>;
              };
        }
      | string
      | null;

    if (typeof details === "string") {
      return details;
    }

    if (typeof details?.detail === "string") {
      return details.detail;
    }

    if (details?.detail && typeof details.detail === "object") {
      const blockers = details.detail.blockers ?? [];
      const warnings = details.detail.warnings ?? [];
      const validationErrors = details.detail.errors ?? [];
      const validationMessage = validationErrors
        .slice(0, 4)
        .map((item) => `${item.row ? `Row ${item.row}, ` : ""}${item.field ? `${item.field}: ` : ""}${item.message ?? "Invalid value."}`)
        .join(" ");
      return [details.detail.message, ...blockers, ...warnings, validationMessage].filter(Boolean).join(" ");
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Request failed.";
}

function datetimeLocalNow() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function inputTime(value: string) {
  return value.slice(0, 5);
}

function scoreTone(score: number) {
  if (score >= 80) {
    return "bg-teal-50 text-teal-800 ring-teal-200";
  }
  if (score >= 65) {
    return "bg-blue-50 text-blue-800 ring-blue-200";
  }
  if (score >= 50) {
    return "bg-amber-50 text-amber-800 ring-amber-200";
  }
  return "bg-slate-100 text-slate-700 ring-slate-200";
}

function statusTone(status: ScannerSymbol["status"]) {
  if (status === "watch") {
    return "bg-teal-50 text-teal-800";
  }
  if (status === "ignore") {
    return "bg-slate-100 text-slate-600";
  }
  return "bg-blue-50 text-blue-800";
}

function toNumber(value: string) {
  return Number(value);
}

function optionalNumber(value: string) {
  return value.trim() === "" ? undefined : Number(value);
}

const workspaceNavigation: Array<{
  id: WorkspaceView;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "scanner", label: "Scanner", description: "Find and rank names", icon: LayoutDashboard },
  { id: "watchlist", label: "Watchlist", description: "Focus today", icon: Eye },
  { id: "planner", label: "Trade planner", description: "Size risk first", icon: Calculator },
  { id: "journal", label: "Journal", description: "Record execution", icon: BookOpen },
  { id: "analytics", label: "Analytics", description: "Review the process", icon: BarChart3 },
  { id: "settings", label: "Risk rules", description: "Set guardrails", icon: Settings },
];

function calculatePlanPreview(
  draft: PlanDraft,
  symbol: ScannerSymbol | null,
  settings: RiskSettings | null,
  riskState: RiskState | null,
): PlanPreview {
  const entry = optionalNumber(draft.entry_price);
  const stop = optionalNumber(draft.stop_price);
  const target = optionalNumber(draft.target_price);
  const accountSize = optionalNumber(draft.account_size) ?? settings?.account_size;
  const riskPct = optionalNumber(draft.max_risk_per_trade_pct) ?? settings?.max_risk_per_trade_pct;
  const ready = Boolean(draft.ticker && entry && stop && accountSize && riskPct);
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!ready) {
    return { ready: false, blockers, warnings, riskPerShare: 0, cashRisk: 0, shares: 0, maxLoss: 0, rMultiple: null };
  }

  if (!entry || !stop || !accountSize || !riskPct) {
    return { ready: false, blockers, warnings, riskPerShare: 0, cashRisk: 0, shares: 0, maxLoss: 0, rMultiple: null };
  }

  if (stop >= entry) {
    blockers.push("Stop must be below entry for this long momentum setup.");
  }
  if (riskState?.daily_lockout) {
    blockers.push("Daily loss limit reached. New plans are locked out.");
  }
  if (riskState && riskState.trades_today >= riskState.max_trades_per_day) {
    blockers.push("Maximum trades for the day has been reached.");
  }

  const riskPerShare = Math.max(0, Math.round((entry - stop) * 10_000) / 10_000);
  const cashRisk = Math.round(accountSize * (riskPct / 100) * 100) / 100;
  const shares = riskPerShare > 0 ? Math.floor((cashRisk + Number.EPSILON) / riskPerShare) : 0;
  const maxLoss = Math.round(shares * riskPerShare * 100) / 100;
  const rMultiple = target && riskPerShare > 0 ? (target - entry) / riskPerShare : null;

  if (riskPerShare > 0 && riskPerShare / entry > 0.15) {
    warnings.push("Risk per share is more than 15% of entry.");
  }
  if (settings && shares > settings.max_position_shares) {
    blockers.push(`Calculated size exceeds your ${number(settings.max_position_shares, 0)} share limit.`);
  }
  if (rMultiple !== null && rMultiple < 1) {
    warnings.push("Target offers less than 1R of reward.");
  }
  if (!symbol) {
    warnings.push("Ticker is not in the current scanner universe.");
  } else if (settings) {
    if (symbol.score < settings.min_score_to_plan) {
      warnings.push(`Score is below your ${settings.min_score_to_plan}-point planning threshold.`);
    }
    if (symbol.spread_pct > settings.max_spread_pct) {
      warnings.push(`Spread is wider than your ${number(settings.max_spread_pct, 1)}% limit.`);
    }
    if (!symbol.latest_catalyst_is_fresh) {
      warnings.push("No catalyst inside the 72-hour freshness window is recorded.");
    }
    if (settings.require_above_vwap && !symbol.above_vwap) {
      warnings.push("Ticker is below VWAP while VWAP confirmation is required.");
    }
  }

  return {
    ready,
    blockers,
    warnings,
    riskPerShare,
    cashRisk,
    shares,
    maxLoss,
    rMultiple,
  };
}

export function TradingDashboard() {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [activeView, setActiveView] = useState<WorkspaceView>("scanner");
  const [scanner, setScanner] = useState<ScannerSymbol[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [catalysts, setCatalysts] = useState<Catalyst[]>([]);
  const [settings, setSettings] = useState<RiskSettings | null>(null);
  const [riskDraft, setRiskDraft] = useState<RiskDraft | null>(null);
  const [riskState, setRiskState] = useState<RiskState | null>(null);
  const [plans, setPlans] = useState<TradePlan[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [analytics, setAnalytics] = useState<Analytics>(emptyAnalytics);
  const [selectedTicker, setSelectedTicker] = useState<string>("");
  const [scannerSearch, setScannerSearch] = useState("");
  const [scannerFilter, setScannerFilter] = useState<ScannerFilter>("all");
  const [watchNotes, setWatchNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [catalystDraft, setCatalystDraft] = useState<CatalystDraft>({
    ticker: "",
    published_time: datetimeLocalNow(),
    source: "Manual",
    headline: "",
    catalyst_type: "FDA",
    quality_score: "20",
  });

  const [planDraft, setPlanDraft] = useState<PlanDraft>({
    plan_date: todayIsoDate(),
    ticker: "",
    account_size: "",
    max_risk_per_trade_pct: "",
    entry_price: "",
    stop_price: "",
    target_price: "",
  });

  const [journalDraft, setJournalDraft] = useState<JournalDraft>({
    trade_date: todayIsoDate(),
    ticker: "",
    setup: "Catalyst momentum",
    catalyst_type: "",
    entry_price: "",
    stop_price: "",
    exit_price: "",
    shares: "",
    pnl: "",
    notes: "",
    mistake_tags: "",
    followed_plan: true,
  });

  const watchedTickers = useMemo(() => new Set(watchlist.map((item) => item.ticker)), [watchlist]);
  const selectedSymbol = useMemo(
    () => scanner.find((symbol) => symbol.ticker === selectedTicker) ?? null,
    [scanner, selectedTicker],
  );
  const selectedCatalysts = useMemo(
    () => catalysts.filter((catalyst) => catalyst.ticker === selectedTicker).slice(0, 4),
    [catalysts, selectedTicker],
  );
  const selectedWatchItem = useMemo(
    () => watchlist.find((item) => item.ticker === selectedTicker) ?? null,
    [watchlist, selectedTicker],
  );
  const filteredScanner = useMemo(() => {
    const query = scannerSearch.trim().toLowerCase();
    return scanner.filter((symbol) => {
      const matchesQuery =
        !query ||
        symbol.ticker.toLowerCase().includes(query) ||
        (symbol.catalyst_type ?? "").toLowerCase().includes(query) ||
        (symbol.news_headline ?? "").toLowerCase().includes(query);
      if (!matchesQuery) {
        return false;
      }
      if (scannerFilter === "qualified") {
        return symbol.score >= (settings?.min_score_to_plan ?? 65);
      }
      if (scannerFilter === "watching") {
        return watchedTickers.has(symbol.ticker);
      }
      if (scannerFilter === "caution") {
        return symbol.risk_warnings.length > 0;
      }
      return true;
    });
  }, [scanner, scannerSearch, scannerFilter, settings?.min_score_to_plan, watchedTickers]);
  const planPreview = useMemo(
    () => calculatePlanPreview(planDraft, selectedSymbol, settings, riskState),
    [planDraft, selectedSymbol, settings, riskState],
  );

  async function loadAll() {
    setError(null);
    const [scannerData, watchlistData, catalystData, settingsData, riskStateData, planData, journalData, analyticsData] =
      await Promise.all([
        apiFetch<ScannerSymbol[]>("/scanner"),
        apiFetch<WatchlistItem[]>("/watchlist"),
        apiFetch<Catalyst[]>("/catalysts"),
        apiFetch<RiskSettings>("/risk-settings"),
        apiFetch<RiskState>("/risk-state"),
        apiFetch<TradePlan[]>("/trade-plans"),
        apiFetch<JournalEntry[]>("/journal"),
        apiFetch<Analytics>("/analytics"),
      ]);

    setScanner(scannerData);
    setWatchlist(watchlistData);
    setCatalysts(catalystData);
    setSettings(settingsData);
    setRiskState(riskStateData);
    setPlans(planData);
    setJournal(journalData);
    setAnalytics(analyticsData);
    setRiskDraft((current) =>
      current ?? {
        account_size: String(settingsData.account_size),
        max_risk_per_trade_pct: String(settingsData.max_risk_per_trade_pct),
        max_daily_loss: String(settingsData.max_daily_loss),
        max_trades_per_day: String(settingsData.max_trades_per_day),
        max_consecutive_losses: String(settingsData.max_consecutive_losses),
        allowed_start_time: inputTime(settingsData.allowed_start_time),
        allowed_end_time: inputTime(settingsData.allowed_end_time),
        min_score_to_plan: String(settingsData.min_score_to_plan),
        max_spread_pct: String(settingsData.max_spread_pct),
        max_position_shares: String(settingsData.max_position_shares),
        require_above_vwap: settingsData.require_above_vwap,
      },
    );
    setWatchNotes((current) => {
      const next = { ...current };
      watchlistData.forEach((item) => {
        if (!(item.ticker in next)) {
          next[item.ticker] = item.notes ?? "";
        }
      });
      return next;
    });
    setPlanDraft((current) => ({
      ...current,
      account_size: current.account_size || String(settingsData.account_size),
      max_risk_per_trade_pct: current.max_risk_per_trade_pct || String(settingsData.max_risk_per_trade_pct),
    }));

    const firstTicker = scannerData[0]?.ticker ?? "";
    if (!selectedTicker && firstTicker) {
      selectTicker(scannerData[0], settingsData);
    }
  }

  useEffect(() => {
    loadAll()
      .catch((loadError: unknown) => setError(apiMessage(loadError)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectTicker(symbol: ScannerSymbol, riskSettings: RiskSettings | null = settings) {
    setSelectedTicker(symbol.ticker);
    setCatalystDraft((current) => ({
      ...current,
      ticker: symbol.ticker,
      catalyst_type: symbol.catalyst_type || current.catalyst_type,
      headline: symbol.news_headline || current.headline,
    }));
    setPlanDraft((current) => ({
      ...current,
      ticker: symbol.ticker,
      entry_price: symbol.price.toFixed(2),
      stop_price: current.ticker === symbol.ticker ? current.stop_price : "",
      target_price: current.ticker === symbol.ticker ? current.target_price : "",
      account_size: current.account_size || String(riskSettings?.account_size ?? ""),
      max_risk_per_trade_pct: current.max_risk_per_trade_pct || String(riskSettings?.max_risk_per_trade_pct ?? ""),
    }));
    setJournalDraft((current) => ({
      ...current,
      ticker: symbol.ticker,
      catalyst_type: symbol.catalyst_type || "",
      entry_price: current.ticker === symbol.ticker ? current.entry_price : "",
      stop_price: current.ticker === symbol.ticker ? current.stop_price : "",
      exit_price: current.ticker === symbol.ticker ? current.exit_price : "",
    }));
  }

  async function refreshWithNotice(message: string) {
    await loadAll();
    setNotice(message);
  }

  async function refreshData() {
    setRefreshing(true);
    setError(null);
    try {
      await loadAll();
      setNotice("Workspace refreshed.");
    } catch (refreshError) {
      setError(apiMessage(refreshError));
    } finally {
      setRefreshing(false);
    }
  }

  async function importSample() {
    setSaving("import");
    setError(null);
    try {
      await apiFetch<ScannerSymbol[]>("/scanner/import-sample", { method: "POST" });
      await refreshWithNotice("Sample scanner data imported.");
    } catch (importError) {
      setError(apiMessage(importError));
    } finally {
      setSaving(null);
    }
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setSaving("csv-import");
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      await apiFetch<ScannerSymbol[]>("/scanner/import-csv", { method: "POST", body });
      await refreshWithNotice(`${file.name} imported into the scanner.`);
      setActiveView("scanner");
    } catch (importError) {
      setError(apiMessage(importError));
    } finally {
      setSaving(null);
    }
  }

  async function updateStatus(ticker: string, status: ScannerSymbol["status"]) {
    setSaving(`${ticker}-${status}`);
    setError(null);
    try {
      await apiFetch<ScannerSymbol>(`/scanner/${ticker}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await refreshWithNotice(status === "watch" ? `${ticker} saved to watchlist.` : `${ticker} marked ${status}.`);
    } catch (statusError) {
      setError(apiMessage(statusError));
    } finally {
      setSaving(null);
    }
  }

  async function toggleWatch(symbol: ScannerSymbol) {
    await updateStatus(symbol.ticker, watchedTickers.has(symbol.ticker) ? "candidate" : "watch");
  }

  async function removeWatchlistItem(ticker: string) {
    setSaving(`remove-${ticker}`);
    setError(null);
    try {
      await apiFetch<void>(`/watchlist/${ticker}`, { method: "DELETE", emptyResponse: true });
      await refreshWithNotice(`${ticker} removed from watchlist.`);
    } catch (removeError) {
      setError(apiMessage(removeError));
    } finally {
      setSaving(null);
    }
  }

  async function saveWatchlistNote(ticker: string) {
    setSaving(`note-${ticker}`);
    setError(null);
    try {
      await apiFetch<WatchlistItem>("/watchlist", {
        method: "POST",
        body: JSON.stringify({ ticker, notes: watchNotes[ticker] || null }),
      });
      await refreshWithNotice(`${ticker} watch notes saved.`);
    } catch (noteError) {
      setError(apiMessage(noteError));
    } finally {
      setSaving(null);
    }
  }

  function startPlan(symbol: ScannerSymbol) {
    selectTicker(symbol);
    setActiveView("planner");
    setNotice(`${symbol.ticker} loaded into the risk planner. Define the stop before sizing.`);
  }

  function navigateTo(view: WorkspaceView) {
    if (view === "watchlist" && (!selectedSymbol || !watchedTickers.has(selectedSymbol.ticker))) {
      const firstWatchedSymbol = watchlist.find((item) => item.symbol)?.symbol;
      if (firstWatchedSymbol) {
        selectTicker(firstWatchedSymbol);
      }
    }
    setActiveView(view);
  }

  function startJournalFromPlan(plan: TradePlan) {
    const symbol = scanner.find((item) => item.ticker === plan.ticker) ?? null;
    if (symbol) {
      setSelectedTicker(symbol.ticker);
    }
    setJournalDraft((current) => ({
      ...current,
      trade_date: todayIsoDate(),
      ticker: plan.ticker,
      catalyst_type: symbol?.catalyst_type ?? current.catalyst_type,
      entry_price: String(plan.entry_price),
      stop_price: String(plan.stop_price),
      exit_price: "",
      shares: String(plan.shares),
      pnl: "",
      notes: "",
      mistake_tags: "",
      followed_plan: true,
    }));
    setActiveView("journal");
    setNotice(`${plan.ticker} plan loaded into the journal. Add the actual exit and review execution.`);
  }

  async function saveCatalyst(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving("catalyst");
    setError(null);
    try {
      await apiFetch("/catalysts", {
        method: "POST",
        body: JSON.stringify({
          ...catalystDraft,
          ticker: catalystDraft.ticker.toUpperCase(),
          quality_score: toNumber(catalystDraft.quality_score),
        }),
      });
      await refreshWithNotice("Catalyst saved.");
      setCatalystDraft((current) => ({ ...current, headline: "" }));
    } catch (catalystError) {
      setError(apiMessage(catalystError));
    } finally {
      setSaving(null);
    }
  }

  async function saveRiskSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!riskDraft) {
      return;
    }

    setSaving("settings");
    setError(null);
    try {
      await apiFetch<RiskSettings>("/risk-settings", {
        method: "PUT",
        body: JSON.stringify({
          account_size: toNumber(riskDraft.account_size),
          max_risk_per_trade_pct: toNumber(riskDraft.max_risk_per_trade_pct),
          max_daily_loss: toNumber(riskDraft.max_daily_loss),
          max_trades_per_day: toNumber(riskDraft.max_trades_per_day),
          max_consecutive_losses: toNumber(riskDraft.max_consecutive_losses),
          allowed_start_time: riskDraft.allowed_start_time,
          allowed_end_time: riskDraft.allowed_end_time,
          min_score_to_plan: toNumber(riskDraft.min_score_to_plan),
          max_spread_pct: toNumber(riskDraft.max_spread_pct),
          max_position_shares: toNumber(riskDraft.max_position_shares),
          require_above_vwap: riskDraft.require_above_vwap,
        }),
      });
      await refreshWithNotice("Risk settings saved.");
    } catch (settingsError) {
      setError(apiMessage(settingsError));
    } finally {
      setSaving(null);
    }
  }

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving("plan");
    setError(null);
    try {
      await apiFetch<TradePlan>("/trade-plans", {
        method: "POST",
        body: JSON.stringify({
          plan_date: planDraft.plan_date,
          ticker: planDraft.ticker.toUpperCase(),
          account_size: optionalNumber(planDraft.account_size),
          max_risk_per_trade_pct: optionalNumber(planDraft.max_risk_per_trade_pct),
          entry_price: toNumber(planDraft.entry_price),
          stop_price: optionalNumber(planDraft.stop_price),
          target_price: optionalNumber(planDraft.target_price),
        }),
      });
      await refreshWithNotice("Trade plan saved.");
    } catch (planError) {
      setError(apiMessage(planError));
    } finally {
      setSaving(null);
    }
  }

  async function saveJournal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving("journal");
    setError(null);
    try {
      await apiFetch<JournalEntry>("/journal", {
        method: "POST",
        body: JSON.stringify({
          trade_date: journalDraft.trade_date,
          ticker: journalDraft.ticker.toUpperCase(),
          setup: journalDraft.setup,
          catalyst_type: journalDraft.catalyst_type || null,
          entry_price: toNumber(journalDraft.entry_price),
          stop_price: toNumber(journalDraft.stop_price),
          exit_price: toNumber(journalDraft.exit_price),
          shares: toNumber(journalDraft.shares),
          pnl: optionalNumber(journalDraft.pnl),
          notes: journalDraft.notes || null,
          mistake_tags: journalDraft.mistake_tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          followed_plan: journalDraft.followed_plan,
        }),
      });
      await refreshWithNotice("Journal entry saved.");
      setJournalDraft((current) => ({
        ...current,
        exit_price: "",
        shares: "",
        pnl: "",
        notes: "",
        mistake_tags: "",
      }));
    } catch (journalError) {
      setError(apiMessage(journalError));
    } finally {
      setSaving(null);
    }
  }

  return (
    <main className="min-h-screen bg-paper">
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-[1500px] px-4 pt-4 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm">
                <Activity className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-semibold tracking-tight text-ink">Catalyst Desk</h1>
                  <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700 ring-1 ring-teal-200">
                    Local workspace
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-slate-500">Rank the move. Define the risk. Review the process.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="text-button" type="button" onClick={() => void refreshData()} disabled={refreshing}>
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
                {refreshing ? "Refreshing" : "Refresh"}
              </button>
              <button className="text-button" type="button" onClick={() => void importSample()} disabled={saving === "import"}>
                <Activity className="h-4 w-4" aria-hidden="true" />
                Load demo
              </button>
              <input ref={importInputRef} hidden type="file" accept=".csv,text/csv" tabIndex={-1} onChange={(event) => void importCsv(event)} />
              <button className="primary-button" type="button" onClick={() => importInputRef.current?.click()} disabled={saving === "csv-import"}>
                <Upload className="h-4 w-4" aria-hidden="true" />
                {saving === "csv-import" ? "Importing" : "Import CSV"}
              </button>
            </div>
          </div>

          <nav className="mt-4 overflow-x-auto" aria-label="Trading workspace">
            <div className="flex min-w-max gap-1" role="tablist" aria-label="Workflow views">
              {workspaceNavigation.map((item) => {
                const Icon = item.icon;
                const selected = activeView === item.id;
                const badge = item.id === "watchlist" ? watchlist.length : item.id === "journal" ? journal.length : null;
                return (
                  <button
                    key={item.id}
                    id={`tab-${item.id}`}
                    className={`group flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold transition ${
                      selected
                        ? "border-blue-700 text-blue-800"
                        : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900"
                    }`}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls="workspace-panel"
                    onClick={() => navigateTo(item.id)}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {item.label}
                    {badge !== null && (
                      <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${selected ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-600"}`}>
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Scanner universe" value={scanner.length.toString()} />
          <Metric label="Active watchlist" value={watchlist.length.toString()} />
          <Metric
            label="Daily loss room"
            value={riskState ? currency(riskState.daily_loss_remaining) : "—"}
            tone={riskState?.daily_lockout ? "bad" : "neutral"}
          />
          <Metric label="Net P&L" value={currency(analytics.net_pnl)} tone={analytics.net_pnl >= 0 ? "good" : "bad"} />
        </div>

        {(error || notice) && (
          <div
            className={`mt-4 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
              error ? "border-red-200 bg-red-50 text-red-800" : "border-teal-200 bg-teal-50 text-teal-800"
            }`}
            role={error ? "alert" : "status"}
            aria-live="polite"
          >
            {error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{error ?? notice}</span>
          </div>
        )}

        <section
          id="workspace-panel"
          className="mt-5"
          role="tabpanel"
          aria-labelledby={`tab-${activeView}`}
          tabIndex={0}
        >
          {activeView === "scanner" && (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="min-w-0 space-y-4">
                <PageHeading
                  eyebrow="Step 1 · Discover"
                  title="Scanner"
                  description="Prioritize catalyst-driven movers, then inspect the score and risk evidence before watching a name."
                />
                <ScannerToolbar
                  search={scannerSearch}
                  setSearch={setScannerSearch}
                  filter={scannerFilter}
                  setFilter={setScannerFilter}
                  resultCount={filteredScanner.length}
                />
                <ScannerTable
                  symbols={filteredScanner}
                  loading={loading}
                  selectedTicker={selectedTicker}
                  watchedTickers={watchedTickers}
                  saving={saving}
                  maxSpreadPct={settings?.max_spread_pct ?? 1.5}
                  onSelect={selectTicker}
                  onToggleWatch={toggleWatch}
                  onIgnore={(symbol) => updateStatus(symbol.ticker, "ignore")}
                />
              </div>
              <aside className="space-y-4 xl:sticky xl:top-[158px] xl:self-start">
                <CandidateDetailPanel
                  symbol={selectedSymbol}
                  catalysts={selectedCatalysts}
                  isWatched={Boolean(selectedSymbol && watchedTickers.has(selectedSymbol.ticker))}
                  saving={saving}
                  onToggleWatch={toggleWatch}
                  onPlan={startPlan}
                />
                <CatalystPanel draft={catalystDraft} setDraft={setCatalystDraft} onSubmit={saveCatalyst} saving={saving === "catalyst"} />
              </aside>
            </div>
          )}

          {activeView === "watchlist" && (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="min-w-0 space-y-4">
                <PageHeading
                  eyebrow="Step 2 · Focus"
                  title="Active watchlist"
                  description="Keep only the names that deserve attention. Add levels and a no-trade condition before planning risk."
                />
                <WatchlistPanel
                  items={watchlist}
                  watchedTickers={watchedTickers}
                  onSelect={(symbol) => selectTicker(symbol)}
                  onRemove={removeWatchlistItem}
                  saving={saving}
                />
                {selectedWatchItem && (
                  <WatchNotesPanel
                    ticker={selectedWatchItem.ticker}
                    value={watchNotes[selectedWatchItem.ticker] ?? ""}
                    onChange={(value) => setWatchNotes((current) => ({ ...current, [selectedWatchItem.ticker]: value }))}
                    onSave={() => saveWatchlistNote(selectedWatchItem.ticker)}
                    saving={saving === `note-${selectedWatchItem.ticker}`}
                  />
                )}
              </div>
              <aside className="space-y-4 xl:sticky xl:top-[158px] xl:self-start">
                <CandidateDetailPanel
                  symbol={selectedSymbol}
                  catalysts={selectedCatalysts}
                  isWatched={Boolean(selectedSymbol && watchedTickers.has(selectedSymbol.ticker))}
                  saving={saving}
                  onToggleWatch={toggleWatch}
                  onPlan={startPlan}
                />
                <RiskStatePanel state={riskState} settings={settings} />
              </aside>
            </div>
          )}

          {activeView === "planner" && (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="min-w-0 space-y-4">
                <PageHeading
                  eyebrow="Step 3 · Define risk"
                  title="Trade planner"
                  description="Set entry, invalidation, and target. Position size is calculated from your risk rules before anything is saved."
                />
                <PlannerPanel
                  draft={planDraft}
                  setDraft={setPlanDraft}
                  onSubmit={savePlan}
                  saving={saving === "plan"}
                  plans={plans}
                  canSubmit={planPreview.ready && planPreview.blockers.length === 0}
                  onJournal={startJournalFromPlan}
                />
              </div>
              <aside className="space-y-4 xl:sticky xl:top-[158px] xl:self-start">
                <PlanPreviewPanel preview={planPreview} ticker={planDraft.ticker} />
                <CandidateDetailPanel
                  symbol={selectedSymbol}
                  catalysts={selectedCatalysts}
                  isWatched={Boolean(selectedSymbol && watchedTickers.has(selectedSymbol.ticker))}
                  saving={saving}
                  onToggleWatch={toggleWatch}
                  onPlan={startPlan}
                  compact
                />
                <RiskStatePanel state={riskState} settings={settings} />
              </aside>
            </div>
          )}

          {activeView === "journal" && (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="min-w-0 space-y-4">
                <PageHeading
                  eyebrow="Step 4 · Review"
                  title="Trade journal"
                  description="Record the actual execution, whether the plan was followed, and the mistake tags that matter."
                />
                <JournalPanel
                  draft={journalDraft}
                  setDraft={setJournalDraft}
                  onSubmit={saveJournal}
                  saving={saving === "journal"}
                  entries={journal}
                />
              </div>
              <aside className="space-y-4">
                <AnalyticsPanel analytics={analytics} journal={journal} />
                <RiskStatePanel state={riskState} settings={settings} />
              </aside>
            </div>
          )}

          {activeView === "analytics" && (
            <div className="space-y-4">
              <PageHeading
                eyebrow="Feedback loop"
                title="Performance analytics"
                description="Use outcomes and process mistakes to improve the playbook—not to turn a small sample into a prediction."
              />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Metric label="Completed trades" value={analytics.total_trades.toString()} />
                <Metric label="Win rate" value={`${number(analytics.win_rate, 1)}%`} />
                <Metric label="Average R" value={`${number(analytics.average_r, 2)}R`} tone={analytics.average_r >= 0 ? "good" : "bad"} />
                <Metric label="Plan adherence" value={journal.length ? `${number((journal.filter((entry) => entry.followed_plan).length / journal.length) * 100, 0)}%` : "—"} />
              </div>
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
                <AnalyticsPanel analytics={analytics} journal={journal} />
                <ProcessReviewPanel analytics={analytics} journal={journal} />
              </div>
            </div>
          )}

          {activeView === "settings" && (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="min-w-0 space-y-4">
                <PageHeading
                  eyebrow="Guardrails"
                  title="Risk rules"
                  description="Set these limits before the session. Planner sizing and warnings use them as the source of truth."
                />
                {riskDraft && (
                  <RiskSettingsPanel draft={riskDraft} setDraft={setRiskDraft} onSubmit={saveRiskSettings} saving={saving === "settings"} />
                )}
              </div>
              <aside className="space-y-4">
                <RiskPrinciplesPanel />
                <RiskStatePanel state={riskState} settings={settings} />
              </aside>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">{eyebrow}</div>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
      </div>
    </div>
  );
}

function ScannerToolbar({
  search,
  setSearch,
  filter,
  setFilter,
  resultCount,
}: {
  search: string;
  setSearch: (value: string) => void;
  filter: ScannerFilter;
  setFilter: (value: ScannerFilter) => void;
  resultCount: number;
}) {
  const filters: Array<{ id: ScannerFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "qualified", label: "Meets score" },
    { id: "watching", label: "Watching" },
    { id: "caution", label: "Has warnings" },
  ];

  return (
    <div className="panel flex flex-col gap-3 rounded-xl p-3 lg:flex-row lg:items-center lg:justify-between">
      <label className="relative block min-w-0 flex-1 lg:max-w-md">
        <span className="sr-only">Search scanner</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          className="field pl-9"
          type="search"
          placeholder="Search ticker, catalyst, or headline"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2" aria-label="Scanner filters">
        {filters.map((item) => (
          <button
            key={item.id}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${
              filter === item.id ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
            }`}
            type="button"
            aria-pressed={filter === item.id}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
        <span className="ml-1 text-xs text-slate-500">{resultCount} names</span>
      </div>
    </div>
  );
}

function ScannerTable({
  symbols,
  loading,
  selectedTicker,
  watchedTickers,
  saving,
  maxSpreadPct,
  onSelect,
  onToggleWatch,
  onIgnore,
}: {
  symbols: ScannerSymbol[];
  loading: boolean;
  selectedTicker: string;
  watchedTickers: Set<string>;
  saving: string | null;
  maxSpreadPct: number;
  onSelect: (symbol: ScannerSymbol) => void;
  onToggleWatch: (symbol: ScannerSymbol) => Promise<void>;
  onIgnore: (symbol: ScannerSymbol) => Promise<void>;
}) {
  if (loading) {
    return <div className="panel rounded-xl px-4 py-16 text-center text-sm text-slate-500">Loading scanner universe…</div>;
  }

  if (symbols.length === 0) {
    return (
      <div className="panel rounded-xl px-5 py-16 text-center">
        <Search className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
        <h3 className="mt-3 font-semibold text-ink">No scanner names match</h3>
        <p className="mt-1 text-sm text-slate-500">Adjust the search or filter, or load the demo dataset.</p>
      </div>
    );
  }

  return (
    <section className="panel overflow-hidden rounded-xl" aria-label="Ranked scanner results">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.08em] text-slate-500">
            <tr>
              <TableHead>Rank</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Momentum</TableHead>
              <TableHead>Structure</TableHead>
              <TableHead>Catalyst</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Action</TableHead>
            </tr>
          </thead>
          <tbody>
            {symbols.map((symbol) => {
              const watched = watchedTickers.has(symbol.ticker);
              const selected = selectedTicker === symbol.ticker;
              return (
                <tr key={symbol.id} className={`border-t border-line transition hover:bg-slate-50 ${selected ? "bg-blue-50/70" : "bg-white"}`}>
                  <td className="px-3 py-3.5 align-top">
                    <span className={`inline-flex min-w-14 justify-center rounded-lg px-2 py-1 text-xs font-semibold ring-1 ${scoreTone(symbol.score)}`}>
                      {symbol.score}
                    </span>
                  </td>
                  <td className="px-3 py-3.5 align-top">
                    <button
                      type="button"
                      className="text-left font-semibold text-blue-700 hover:text-blue-900"
                      aria-current={selected ? "true" : undefined}
                      onClick={() => onSelect(symbol)}
                    >
                      {symbol.ticker}
                    </button>
                    <div className="mt-1 text-xs text-slate-500">{currency(symbol.price)}</div>
                  </td>
                  <td className="px-3 py-3.5 align-top">
                    <div className="font-semibold text-ink">+{number(symbol.gap_pct, 1)}% gap</div>
                    <div className="mt-1 text-xs text-slate-500">{number(symbol.rel_volume, 1)}× relative volume</div>
                  </td>
                  <td className="px-3 py-3.5 align-top">
                    <div className="text-ink">{number(symbol.float_m, 1)}M float</div>
                    <div className={`mt-1 text-xs ${symbol.spread_pct > maxSpreadPct ? "font-semibold text-amber-700" : "text-slate-500"}`}>
                      {number(symbol.spread_pct, 1)}% spread
                    </div>
                  </td>
                  <td className="max-w-[300px] px-3 py-3.5 align-top">
                    <div className="font-medium text-ink">{symbol.catalyst_type || "No category"}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{symbol.news_headline || "No fresh catalyst recorded"}</div>
                  </td>
                  <td className="px-3 py-3.5 align-top">
                    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${statusTone(symbol.status)}`}>{symbol.label}</span>
                    <div className={`mt-1.5 text-xs ${symbol.above_vwap ? "text-teal-700" : "text-red-700"}`}>
                      {symbol.above_vwap ? "Above VWAP" : "Below VWAP"}
                    </div>
                  </td>
                  <td className="px-3 py-3.5 align-top">
                    <div className="flex items-center gap-2">
                      <button
                        className={watched ? "secondary-active-button" : "text-button"}
                        type="button"
                        aria-label={watched ? `Remove ${symbol.ticker} from watchlist` : `Add ${symbol.ticker} to watchlist`}
                        aria-pressed={watched}
                        disabled={saving === `${symbol.ticker}-watch` || saving === `${symbol.ticker}-candidate`}
                        onClick={() => void onToggleWatch(symbol)}
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                        {watched ? "Watching" : "Watch"}
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Ignore ${symbol.ticker}`}
                        disabled={saving === `${symbol.ticker}-ignore`}
                        onClick={() => void onIgnore(symbol)}
                      >
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-line md:hidden">
        {symbols.map((symbol) => {
          const watched = watchedTickers.has(symbol.ticker);
          return (
            <article key={symbol.id} className={`p-4 ${selectedTicker === symbol.ticker ? "bg-blue-50/70" : "bg-white"}`}>
              <div className="flex items-start justify-between gap-3">
                <button type="button" className="text-left" onClick={() => onSelect(symbol)}>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold text-blue-800">{symbol.ticker}</span>
                    <span className={`rounded-md px-2 py-1 text-xs font-semibold ring-1 ${scoreTone(symbol.score)}`}>{symbol.score}</span>
                  </div>
                  <div className="mt-1 text-sm text-slate-600">{currency(symbol.price)} · +{number(symbol.gap_pct, 1)}% · {number(symbol.rel_volume, 1)}× RVOL</div>
                </button>
                <button
                  className={watched ? "secondary-active-button" : "icon-button"}
                  type="button"
                  aria-label={watched ? `Remove ${symbol.ticker} from watchlist` : `Add ${symbol.ticker} to watchlist`}
                  aria-pressed={watched}
                  onClick={() => void onToggleWatch(symbol)}
                >
                  <Eye className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-3 text-sm font-medium text-ink">{symbol.catalyst_type || "No catalyst category"}</div>
              <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-500">{symbol.news_headline || "No fresh catalyst recorded"}</p>
              <button className="mt-3 flex items-center gap-1 text-sm font-semibold text-blue-700" type="button" onClick={() => onSelect(symbol)}>
                Review evidence <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CandidateDetailPanel({
  symbol,
  catalysts,
  isWatched,
  saving,
  onToggleWatch,
  onPlan,
  compact = false,
}: {
  symbol: ScannerSymbol | null;
  catalysts: Catalyst[];
  isWatched: boolean;
  saving: string | null;
  onToggleWatch: (symbol: ScannerSymbol) => Promise<void>;
  onPlan: (symbol: ScannerSymbol) => void;
  compact?: boolean;
}) {
  if (!symbol) {
    return (
      <section className="panel rounded-xl p-6 text-center">
        <ClipboardList className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
        <h3 className="mt-3 font-semibold text-ink">Select a scanner name</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500">Its score evidence, catalyst, and risk flags will appear here.</p>
      </section>
    );
  }

  const catalystFreshnessLabel = symbol.latest_catalyst_published_time
    ? symbol.latest_catalyst_is_fresh
      ? "Fresh · within 72h"
      : "Stale · over 72h"
    : "No dated catalyst";

  return (
    <section className="panel overflow-hidden rounded-xl">
      <div className="border-b border-line bg-slate-950 px-4 py-4 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-2xl font-semibold">{symbol.ticker}</h3>
              <span className="rounded-full bg-white/10 px-2 py-1 text-xs font-semibold text-slate-200">{symbol.label}</span>
            </div>
            <div className="mt-1 text-sm text-slate-300">{currency(symbol.price)} · {number(symbol.market_cap_m, 1)}M market cap</div>
          </div>
          <div className="rounded-xl bg-white px-3 py-2 text-center text-slate-950">
            <div className="text-2xl font-semibold leading-none">{symbol.score}</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Score</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-white/10 px-2 py-2"><span className="block font-semibold">{number(symbol.gap_pct, 1)}%</span><span className="text-slate-300">Gap</span></div>
          <div className="rounded-lg bg-white/10 px-2 py-2"><span className="block font-semibold">{number(symbol.rel_volume, 1)}×</span><span className="text-slate-300">RVOL</span></div>
          <div className="rounded-lg bg-white/10 px-2 py-2"><span className="block font-semibold">{number(symbol.spread_pct, 1)}%</span><span className="text-slate-300">Spread</span></div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <div className="label">Why it is moving</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{symbol.catalyst_type || "No catalyst category"}</span>
            <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${symbol.latest_catalyst_is_fresh ? "bg-teal-50 text-teal-700" : "bg-amber-50 text-amber-800"}`}>
              {catalystFreshnessLabel}
            </span>
            {symbol.latest_catalyst_quality_score != null && (
              <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                Quality {symbol.latest_catalyst_quality_score}/20
              </span>
            )}
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">{symbol.news_headline || "No fresh catalyst has been recorded."}</p>
        </div>

        <div>
          <div className="label">Score evidence</div>
          <ul className="mt-2 space-y-2">
            {symbol.reasons.map((reason) => (
              <li key={reason} className="flex gap-2 text-sm text-slate-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
                <span>{reason}</span>
              </li>
            ))}
            {symbol.reasons.length === 0 && <li className="text-sm text-slate-500">No positive scoring factors recorded.</li>}
          </ul>
        </div>

        <div>
          <div className="label">Risk review</div>
          <ul className="mt-2 space-y-2">
            {symbol.risk_warnings.map((warning) => (
              <li key={warning} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{warning}</span>
              </li>
            ))}
            {symbol.risk_warnings.length === 0 && (
              <li className="flex gap-2 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>No current scanner warnings. A valid plan still requires a defined stop.</span>
              </li>
            )}
          </ul>
        </div>

        {!compact && catalysts.length > 0 && (
          <div>
            <div className="label">Catalyst history</div>
            <div className="mt-2 space-y-2">
              {catalysts.map((catalyst) => (
                <div key={catalyst.id} className="rounded-lg border border-line px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span>{catalyst.source}</span>
                    <span>{new Date(catalyst.published_time).toLocaleDateString()}</span>
                  </div>
                  <div className="mt-1 text-sm font-medium text-ink">{catalyst.headline}</div>
                  <div className="mt-1 text-xs text-slate-500">{catalyst.catalyst_type} · quality {catalyst.quality_score}/20</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            className={isWatched ? "secondary-active-button" : "text-button"}
            type="button"
            aria-pressed={isWatched}
            disabled={saving === `${symbol.ticker}-watch` || saving === `${symbol.ticker}-candidate`}
            onClick={() => void onToggleWatch(symbol)}
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            {isWatched ? "Watching" : "Add to watchlist"}
          </button>
          <button className="primary-button" type="button" onClick={() => onPlan(symbol)}>
            Build plan <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}

function WatchNotesPanel({
  ticker,
  value,
  onChange,
  onSave,
  saving,
}: {
  ticker: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => Promise<void>;
  saving: boolean;
}) {
  return (
    <section className="panel rounded-xl">
      <div className="border-b border-line px-4 py-3">
        <h3 className="font-semibold text-ink">{ticker} watch notes</h3>
        <p className="mt-1 text-sm text-slate-500">Record the key level, invalidation, and what would make you stand aside.</p>
      </div>
      <div className="p-4">
        <textarea
          className="field min-h-28"
          value={value}
          placeholder="Example: Valid only above $3.20 with volume. No chase over $3.60. Invalid below VWAP."
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="mt-3 flex justify-end">
          <button className="primary-button" type="button" disabled={saving} onClick={() => void onSave()}>
            <Save className="h-4 w-4" aria-hidden="true" />
            Save notes
          </button>
        </div>
      </div>
    </section>
  );
}

function PlanPreviewPanel({ preview, ticker }: { preview: PlanPreview; ticker: string }) {
  return (
    <section className="panel overflow-hidden rounded-xl">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Calculator className="h-4 w-4 text-blue-700" aria-hidden="true" />
        <div>
          <h3 className="font-semibold text-ink">Live risk preview</h3>
          <p className="text-xs text-slate-500">{ticker ? `Sizing ${ticker}` : "Choose a ticker"}</p>
        </div>
      </div>
      {!preview.ready ? (
        <div className="px-4 py-8 text-center">
          <ShieldCheck className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
          <div className="mt-3 font-semibold text-ink">Define entry and stop</div>
          <p className="mt-1 text-sm leading-6 text-slate-500">Sizing appears before save once the invalidation price is explicit.</p>
        </div>
      ) : (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-3">
            <PreviewStat label="Risk / share" value={currency(preview.riskPerShare)} />
            <PreviewStat label="Cash risk cap" value={currency(preview.cashRisk)} />
            <PreviewStat label="Position size" value={`${number(preview.shares, 0)} shares`} emphasize />
            <PreviewStat label="Max loss" value={currency(preview.maxLoss)} emphasize />
            <PreviewStat label="Reward" value={preview.rMultiple === null ? "No target" : `${number(preview.rMultiple, 2)}R`} />
            <PreviewStat label="Plan state" value={preview.blockers.length ? "Blocked" : preview.warnings.length ? "Review" : "Ready"} />
          </div>
          {preview.blockers.map((blocker) => (
            <div key={blocker} className="flex gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{blocker}</span>
            </div>
          ))}
          {preview.warnings.map((warning) => (
            <div key={warning} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{warning}</span>
            </div>
          ))}
          {preview.blockers.length === 0 && preview.warnings.length === 0 && (
            <div className="flex gap-2 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Plan fits the current risk rules.</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PreviewStat({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="label">{label}</div>
      <div className={`mt-1 ${emphasize ? "text-lg" : "text-sm"} font-semibold text-ink`}>{value}</div>
    </div>
  );
}

function ProcessReviewPanel({ analytics, journal }: { analytics: Analytics; journal: JournalEntry[] }) {
  const unplanned = journal.filter((entry) => !entry.followed_plan).length;
  return (
    <section className="panel rounded-xl">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <ClipboardList className="h-4 w-4 text-blue-700" aria-hidden="true" />
        <h3 className="font-semibold text-ink">Process review</h3>
      </div>
      <div className="divide-y divide-line">
        <ReviewRow label="Best catalyst so far" value={analytics.best_catalyst_type ?? "Not enough data"} />
        <ReviewRow label="Most common mistake" value={analytics.most_common_mistake ?? "None recorded"} />
        <ReviewRow label="Trades outside plan" value={unplanned.toString()} tone={unplanned > 0 ? "bad" : "neutral"} />
        <ReviewRow label="Average win / loss" value={`${currency(analytics.average_win)} / ${currency(analytics.average_loss)}`} />
      </div>
      <p className="border-t border-line bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
        Treat small samples as feedback, not prediction. Improve the checklist before changing the scoring model.
      </p>
    </section>
  );
}

function ReviewRow({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "bad" }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right font-semibold ${tone === "bad" ? "text-red-700" : "text-ink"}`}>{value}</span>
    </div>
  );
}

function RiskPrinciplesPanel() {
  const principles = [
    "Every plan requires a stop before position sizing.",
    "Daily loss and trade-count limits override opportunity.",
    "Score prioritizes attention; it is never a buy signal.",
    "Wide spreads, weak catalysts, and VWAP failures require review.",
  ];
  return (
    <section className="panel rounded-xl p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-teal-700" aria-hidden="true" />
        <h3 className="font-semibold text-ink">Planning principles</h3>
      </div>
      <ul className="mt-4 space-y-3">
        {principles.map((principle) => (
          <li key={principle} className="flex gap-2 text-sm leading-6 text-slate-600">
            <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
            <span>{principle}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "bad" }) {
  const toneClass = tone === "good" ? "text-teal-700" : tone === "bad" ? "text-red-700" : "text-ink";
  return (
    <div className="panel rounded-xl px-4 py-3">
      <div className="label">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function TableHead({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-3 font-semibold">{children}</th>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function PlannerPanel({
  draft,
  setDraft,
  onSubmit,
  saving,
  plans,
  canSubmit,
  onJournal,
}: {
  draft: PlanDraft;
  setDraft: React.Dispatch<React.SetStateAction<PlanDraft>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  plans: TradePlan[];
  canSubmit: boolean;
  onJournal: (plan: TradePlan) => void;
}) {
  return (
    <section className="panel overflow-hidden rounded-xl">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Calculator className="h-4 w-4 text-blue-700" aria-hidden="true" />
        <div>
          <h3 className="font-semibold text-ink">Plan inputs</h3>
          <p className="text-xs text-slate-500">Use the live preview to review size and every rule before saving.</p>
        </div>
      </div>
      <form className="grid gap-3 px-4 py-4 sm:grid-cols-2" onSubmit={onSubmit}>
        <Field label="Date">
          <input
            className="field"
            type="date"
            value={draft.plan_date}
            onChange={(event) => setDraft((current) => ({ ...current, plan_date: event.target.value }))}
          />
        </Field>
        <Field label="Ticker">
          <input
            className="field uppercase"
            value={draft.ticker}
            required
            onChange={(event) => setDraft((current) => ({ ...current, ticker: event.target.value.toUpperCase() }))}
          />
        </Field>
        <Field label="Account size">
          <input
            className="field"
            type="number"
            min="1"
            step="0.01"
            value={draft.account_size}
            onChange={(event) => setDraft((current) => ({ ...current, account_size: event.target.value }))}
          />
        </Field>
        <Field label="Risk per trade %">
          <input
            className="field"
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            value={draft.max_risk_per_trade_pct}
            onChange={(event) => setDraft((current) => ({ ...current, max_risk_per_trade_pct: event.target.value }))}
          />
        </Field>
        <Field label="Entry">
          <input
            className="field"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={draft.entry_price}
            onChange={(event) => setDraft((current) => ({ ...current, entry_price: event.target.value }))}
          />
          <span className="mt-1 block text-xs text-slate-500">Scanner price is a reference—not an entry signal.</span>
        </Field>
        <Field label="Stop">
          <input
            className="field"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={draft.stop_price}
            onChange={(event) => setDraft((current) => ({ ...current, stop_price: event.target.value }))}
          />
        </Field>
        <Field label="Target">
          <input
            className="field"
            type="number"
            min="0.01"
            step="0.01"
            value={draft.target_price}
            onChange={(event) => setDraft((current) => ({ ...current, target_price: event.target.value }))}
          />
        </Field>
        <div className="flex items-end">
          <button className="primary-button w-full" type="submit" disabled={saving || !canSubmit}>
            <Save className="h-4 w-4" />
            {canSubmit ? "Save plan" : "Complete valid plan"}
          </button>
        </div>
      </form>
      <div className="max-h-[520px] overflow-y-auto border-t border-line">
        {plans.map((plan) => (
          <div key={plan.id} className="grid gap-3 border-b border-line px-4 py-3 text-sm last:border-b-0 sm:grid-cols-[1fr_auto]">
            <div>
              <div className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                <span>{plan.ticker} · {number(plan.shares, 0)} shares</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{plan.plan_date}</span>
              </div>
              <div className="mt-1 text-slate-500">
                Entry {currency(plan.entry_price)} · stop {currency(plan.stop_price)} · max loss {currency(plan.max_loss)}
              </div>
              {plan.warnings.map((warning) => (
                <div key={warning} className="mt-1 text-amber-700">{warning}</div>
              ))}
            </div>
            <div className="flex items-center gap-2 sm:flex-col sm:items-end">
              <div className="font-semibold text-slate-700">{plan.r_multiple ? `${number(plan.r_multiple, 2)}R` : "No target"}</div>
              <button className="text-button" type="button" onClick={() => onJournal(plan)}>
                Journal <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
        {plans.length === 0 && <div className="px-4 py-4 text-sm text-slate-500">No trade plans saved.</div>}
      </div>
    </section>
  );
}

function JournalPanel({
  draft,
  setDraft,
  onSubmit,
  saving,
  entries,
}: {
  draft: JournalDraft;
  setDraft: React.Dispatch<React.SetStateAction<JournalDraft>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  entries: JournalEntry[];
}) {
  return (
    <section className="panel overflow-hidden rounded-xl">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <BookOpen className="h-4 w-4 text-blue-700" />
        <h2 className="text-base font-semibold text-ink">Journal</h2>
      </div>
      <form className="grid gap-3 px-4 py-4 sm:grid-cols-2" onSubmit={onSubmit}>
        <Field label="Date">
          <input
            className="field"
            type="date"
            value={draft.trade_date}
            onChange={(event) => setDraft((current) => ({ ...current, trade_date: event.target.value }))}
          />
        </Field>
        <Field label="Ticker">
          <input
            className="field uppercase"
            value={draft.ticker}
            required
            onChange={(event) => setDraft((current) => ({ ...current, ticker: event.target.value.toUpperCase() }))}
          />
        </Field>
        <Field label="Setup">
          <input
            className="field"
            value={draft.setup}
            onChange={(event) => setDraft((current) => ({ ...current, setup: event.target.value }))}
          />
        </Field>
        <Field label="Catalyst">
          <input
            className="field"
            value={draft.catalyst_type}
            onChange={(event) => setDraft((current) => ({ ...current, catalyst_type: event.target.value }))}
          />
        </Field>
        <Field label="Entry">
          <input
            className="field"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={draft.entry_price}
            onChange={(event) => setDraft((current) => ({ ...current, entry_price: event.target.value }))}
          />
        </Field>
        <Field label="Stop">
          <input
            className="field"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={draft.stop_price}
            onChange={(event) => setDraft((current) => ({ ...current, stop_price: event.target.value }))}
          />
        </Field>
        <Field label="Exit">
          <input
            className="field"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={draft.exit_price}
            onChange={(event) => setDraft((current) => ({ ...current, exit_price: event.target.value }))}
          />
        </Field>
        <Field label="Shares">
          <input
            className="field"
            type="number"
            min="1"
            step="1"
            required
            value={draft.shares}
            onChange={(event) => setDraft((current) => ({ ...current, shares: event.target.value }))}
          />
        </Field>
        <Field label="P&L override">
          <input
            className="field"
            type="number"
            step="0.01"
            value={draft.pnl}
            onChange={(event) => setDraft((current) => ({ ...current, pnl: event.target.value }))}
          />
        </Field>
        <Field label="Mistake tags">
          <input
            className="field"
            value={draft.mistake_tags}
            onChange={(event) => setDraft((current) => ({ ...current, mistake_tags: event.target.value }))}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={draft.followed_plan}
            onChange={(event) => setDraft((current) => ({ ...current, followed_plan: event.target.checked }))}
          />
          Followed plan
        </label>
        <div className="flex items-end">
          <button className="primary-button w-full" type="submit" disabled={saving}>
            <Plus className="h-4 w-4" />
            Add entry
          </button>
        </div>
        <div className="sm:col-span-2">
          <Field label="Notes">
            <textarea
              className="field min-h-20"
              value={draft.notes}
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
            />
          </Field>
        </div>
      </form>
      <div className="max-h-[360px] overflow-y-auto border-t border-line">
        {entries.slice(0, 8).map((entry) => (
          <div key={entry.id} className="grid gap-1 border-b border-line px-4 py-3 text-sm last:border-b-0">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-ink">
                {entry.trade_date} {entry.ticker}
              </span>
              <span className={entry.pnl >= 0 ? "font-semibold text-teal-700" : "font-semibold text-red-700"}>
                {currency(entry.pnl)} / {number(entry.r_multiple, 2)}R
              </span>
            </div>
            <div className="text-slate-500">
              {entry.setup} {entry.followed_plan ? "" : "/ rule break"}
            </div>
          </div>
        ))}
        {entries.length === 0 && <div className="px-4 py-4 text-sm text-slate-500">No journal entries saved.</div>}
      </div>
    </section>
  );
}

function RiskStatePanel({ state, settings }: { state: RiskState | null; settings: RiskSettings | null }) {
  return (
    <section className="panel overflow-hidden rounded-xl">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <AlertTriangle className="h-4 w-4 text-amber-700" />
        <h2 className="text-base font-semibold text-ink">Daily Risk</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 px-4 py-4 text-sm">
        <div>
          <div className="label">Realized P&L</div>
          <div className={state && state.daily_realized_pnl < 0 ? "mt-1 font-semibold text-red-700" : "mt-1 font-semibold text-teal-700"}>
            {state ? currency(state.daily_realized_pnl) : "-"}
          </div>
        </div>
        <div>
          <div className="label">Loss room</div>
          <div className="mt-1 font-semibold text-ink">{state ? currency(state.daily_loss_remaining) : "-"}</div>
        </div>
        <div>
          <div className="label">Trades</div>
          <div className="mt-1 font-semibold text-ink">
            {state ? `${state.trades_today}/${state.max_trades_per_day}` : "-"}
          </div>
        </div>
        <div>
          <div className="label">Max risk</div>
          <div className="mt-1 font-semibold text-ink">{settings ? `${settings.max_risk_per_trade_pct}%` : "-"}</div>
        </div>
      </div>
      {state?.daily_lockout && (
        <div className="border-t border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          Daily lockout: Max daily loss reached.
        </div>
      )}
    </section>
  );
}

function WatchlistPanel({
  items,
  watchedTickers,
  onSelect,
  onRemove,
  saving,
}: {
  items: WatchlistItem[];
  watchedTickers: Set<string>;
  onSelect: (symbol: ScannerSymbol) => void;
  onRemove: (ticker: string) => Promise<void>;
  saving: string | null;
}) {
  return (
    <section className="panel overflow-hidden rounded-xl">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-blue-700" aria-hidden="true" />
          <h3 className="font-semibold text-ink">Names in focus</h3>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{items.length} active</span>
      </div>
      <div className="grid gap-3 p-3 sm:grid-cols-2">
        {items.map((item) => (
          <article key={item.id} className={`rounded-xl border p-4 ${watchedTickers.has(item.ticker) ? "border-blue-200 bg-blue-50/40" : "border-line bg-white"}`}>
            <div className="flex items-start justify-between gap-3">
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => item.symbol && onSelect(item.symbol)}
              disabled={!item.symbol}
            >
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold text-ink">{item.ticker}</span>
                {item.symbol && <span className={`rounded-md px-2 py-1 text-xs font-semibold ring-1 ${scoreTone(item.symbol.score)}`}>{item.symbol.score}</span>}
              </div>
              <div className="mt-1 text-sm text-slate-500">{item.symbol ? `${item.symbol.label} · ${item.symbol.above_vwap ? "above VWAP" : "below VWAP"}` : "Manual watch"}</div>
            </button>
            <button
              className="icon-button shrink-0"
              type="button"
              aria-label={`Remove ${item.ticker} from watchlist`}
              disabled={saving === `remove-${item.ticker}`}
              onClick={() => void onRemove(item.ticker)}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
            </div>
            {item.symbol && (
              <>
                <p className="mt-3 line-clamp-2 text-sm leading-5 text-slate-600">{item.symbol.news_headline || "No catalyst recorded"}</p>
                <button className="mt-3 flex items-center gap-1 text-sm font-semibold text-blue-700" type="button" onClick={() => onSelect(item.symbol!)}>
                  Open review <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            )}
            {item.notes && <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs leading-5 text-slate-600">{item.notes}</p>}
          </article>
        ))}
        {items.length === 0 && (
          <div className="col-span-full px-4 py-12 text-center">
            <Eye className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
            <h3 className="mt-3 font-semibold text-ink">Watchlist is clear</h3>
            <p className="mt-1 text-sm text-slate-500">Return to the scanner and keep only names with a defensible catalyst and risk profile.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function CatalystPanel({
  draft,
  setDraft,
  onSubmit,
  saving,
}: {
  draft: CatalystDraft;
  setDraft: React.Dispatch<React.SetStateAction<CatalystDraft>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  return (
    <section className="panel overflow-hidden rounded-xl">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Plus className="h-4 w-4 text-blue-700" />
        <h2 className="text-base font-semibold text-ink">Catalyst</h2>
      </div>
      <form className="grid gap-3 px-4 py-4" onSubmit={onSubmit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ticker">
            <input
              className="field uppercase"
              required
              value={draft.ticker}
              onChange={(event) => setDraft((current) => ({ ...current, ticker: event.target.value.toUpperCase() }))}
            />
          </Field>
          <Field label="Published">
            <input
              className="field"
              type="datetime-local"
              value={draft.published_time}
              onChange={(event) => setDraft((current) => ({ ...current, published_time: event.target.value }))}
            />
          </Field>
          <Field label="Source">
            <input
              className="field"
              value={draft.source}
              onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))}
            />
          </Field>
          <Field label="Type">
            <select
              className="field"
              value={draft.catalyst_type}
              onChange={(event) => setDraft((current) => ({ ...current, catalyst_type: event.target.value }))}
            >
              <option>FDA</option>
              <option>Clinical data</option>
              <option>Earnings</option>
              <option>Contract</option>
              <option>Partnership</option>
              <option>Guidance</option>
              <option>Analyst action</option>
              <option>Vague PR</option>
              <option>Offering</option>
              <option>No fresh news</option>
            </select>
          </Field>
        </div>
        <Field label="Headline">
          <textarea
            className="field min-h-20"
            required
            value={draft.headline}
            onChange={(event) => setDraft((current) => ({ ...current, headline: event.target.value }))}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Quality score">
            <input
              className="field"
              type="number"
              min="0"
              max="20"
              step="1"
              value={draft.quality_score}
              onChange={(event) => setDraft((current) => ({ ...current, quality_score: event.target.value }))}
            />
            <span className="mt-1 block text-xs leading-5 text-slate-500">A fresh catalyst contributes this many points, up to 20.</span>
          </Field>
          <div className="flex items-end">
            <button className="primary-button w-full" type="submit" disabled={saving}>
              <Save className="h-4 w-4" />
              Save
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

function RiskSettingsPanel({
  draft,
  setDraft,
  onSubmit,
  saving,
}: {
  draft: RiskDraft;
  setDraft: React.Dispatch<React.SetStateAction<RiskDraft | null>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  function patch(update: Partial<RiskDraft>) {
    setDraft((current) => (current ? { ...current, ...update } : current));
  }

  return (
    <section className="panel overflow-hidden rounded-xl">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Settings className="h-4 w-4 text-blue-700" />
        <h2 className="text-base font-semibold text-ink">Risk Settings</h2>
      </div>
      <form className="grid gap-3 px-4 py-4 sm:grid-cols-2" onSubmit={onSubmit}>
        <Field label="Account size">
          <input className="field" type="number" min="1" step="0.01" value={draft.account_size} onChange={(event) => patch({ account_size: event.target.value })} />
        </Field>
        <Field label="Risk %">
          <input
            className="field"
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            value={draft.max_risk_per_trade_pct}
            onChange={(event) => patch({ max_risk_per_trade_pct: event.target.value })}
          />
        </Field>
        <Field label="Daily loss">
          <input
            className="field"
            type="number"
            min="1"
            step="0.01"
            value={draft.max_daily_loss}
            onChange={(event) => patch({ max_daily_loss: event.target.value })}
          />
        </Field>
        <Field label="Max trades">
          <input
            className="field"
            type="number"
            min="1"
            step="1"
            value={draft.max_trades_per_day}
            onChange={(event) => patch({ max_trades_per_day: event.target.value })}
          />
        </Field>
        <Field label="Max losses">
          <input
            className="field"
            type="number"
            min="1"
            step="1"
            value={draft.max_consecutive_losses}
            onChange={(event) => patch({ max_consecutive_losses: event.target.value })}
          />
        </Field>
        <Field label="Min score">
          <input
            className="field"
            type="number"
            min="0"
            max="100"
            step="1"
            value={draft.min_score_to_plan}
            onChange={(event) => patch({ min_score_to_plan: event.target.value })}
          />
        </Field>
        <Field label="Max spread %">
          <input
            className="field"
            type="number"
            min="0.01"
            step="0.01"
            value={draft.max_spread_pct}
            onChange={(event) => patch({ max_spread_pct: event.target.value })}
          />
        </Field>
        <Field label="Max shares">
          <input
            className="field"
            type="number"
            min="1"
            step="1"
            value={draft.max_position_shares}
            onChange={(event) => patch({ max_position_shares: event.target.value })}
          />
        </Field>
        <Field label="Start">
          <input className="field" type="time" value={draft.allowed_start_time} onChange={(event) => patch({ allowed_start_time: event.target.value })} />
        </Field>
        <Field label="End">
          <input className="field" type="time" value={draft.allowed_end_time} onChange={(event) => patch({ allowed_end_time: event.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:col-span-2">
          <input
            type="checkbox"
            checked={draft.require_above_vwap}
            onChange={(event) => patch({ require_above_vwap: event.target.checked })}
          />
          Require VWAP confirmation
        </label>
        <button className="primary-button sm:col-span-2" type="submit" disabled={saving}>
          <Save className="h-4 w-4" />
          Save settings
        </button>
      </form>
    </section>
  );
}

function AnalyticsPanel({ analytics, journal }: { analytics: Analytics; journal: JournalEntry[] }) {
  return (
    <section className="panel overflow-hidden rounded-xl">
      <div className="flex items-center gap-2 px-4 py-3">
        <BarChart3 className="h-4 w-4 text-blue-700" />
        <h2 className="text-base font-semibold text-ink">Analytics</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-line px-4 py-4 text-sm">
        <Stat label="Trades" value={analytics.total_trades.toString()} />
        <Stat label="Avg R" value={`${number(analytics.average_r, 2)}R`} />
        <Stat label="Avg win" value={currency(analytics.average_win)} />
        <Stat label="Avg loss" value={currency(analytics.average_loss)} />
        <Stat label="Best catalyst" value={analytics.best_catalyst_type ?? "-"} />
        <Stat label="Top mistake" value={analytics.most_common_mistake ?? "-"} />
      </div>
      <EquityChart entries={journal} />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mt-1 break-words font-semibold text-ink">{value}</div>
    </div>
  );
}
