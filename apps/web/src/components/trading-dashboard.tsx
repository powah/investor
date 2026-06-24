"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Calculator,
  CheckCircle2,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Trash2,
  Upload,
} from "lucide-react";
import { EquityChart } from "@/components/equity-chart";
import { ApiError, apiFetch, currency, number, todayIsoDate } from "@/lib/api";
import type {
  Analytics,
  JournalEntry,
  RiskSettings,
  RiskState,
  ScannerSymbol,
  TradePlan,
  WatchlistItem,
} from "@/types/trading";

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
          detail?: string | { blockers?: string[]; warnings?: string[] };
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
      return [...blockers, ...warnings].join(" ");
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

export function TradingDashboard() {
  const [scanner, setScanner] = useState<ScannerSymbol[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [settings, setSettings] = useState<RiskSettings | null>(null);
  const [riskDraft, setRiskDraft] = useState<RiskDraft | null>(null);
  const [riskState, setRiskState] = useState<RiskState | null>(null);
  const [plans, setPlans] = useState<TradePlan[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [analytics, setAnalytics] = useState<Analytics>(emptyAnalytics);
  const [selectedTicker, setSelectedTicker] = useState<string>("");
  const [loading, setLoading] = useState(true);
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

  async function loadAll() {
    setError(null);
    const [scannerData, watchlistData, settingsData, riskStateData, planData, journalData, analyticsData] =
      await Promise.all([
        apiFetch<ScannerSymbol[]>("/scanner"),
        apiFetch<WatchlistItem[]>("/watchlist"),
        apiFetch<RiskSettings>("/risk-settings"),
        apiFetch<RiskState>("/risk-state"),
        apiFetch<TradePlan[]>("/trade-plans"),
        apiFetch<JournalEntry[]>("/journal"),
        apiFetch<Analytics>("/analytics"),
      ]);

    setScanner(scannerData);
    setWatchlist(watchlistData);
    setSettings(settingsData);
    setRiskState(riskStateData);
    setPlans(planData);
    setJournal(journalData);
    setAnalytics(analyticsData);
    setRiskDraft({
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
    });

    const firstTicker = scannerData[0]?.ticker ?? "";
    if (!selectedTicker && firstTicker) {
      selectTicker(scannerData[0]);
    }
  }

  useEffect(() => {
    loadAll()
      .catch((loadError: unknown) => setError(apiMessage(loadError)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectTicker(symbol: ScannerSymbol) {
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
      stop_price: (symbol.price * 0.94).toFixed(2),
      target_price: (symbol.price * 1.12).toFixed(2),
      account_size: current.account_size || String(settings?.account_size ?? ""),
      max_risk_per_trade_pct: current.max_risk_per_trade_pct || String(settings?.max_risk_per_trade_pct ?? ""),
    }));
    setJournalDraft((current) => ({
      ...current,
      ticker: symbol.ticker,
      catalyst_type: symbol.catalyst_type || "",
      entry_price: symbol.price.toFixed(2),
      stop_price: (symbol.price * 0.94).toFixed(2),
      exit_price: symbol.price.toFixed(2),
    }));
  }

  async function refreshWithNotice(message: string) {
    await loadAll();
    setNotice(message);
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
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-ink">Small-Cap Catalyst Momentum</h1>
            <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-600">
              <span className="rounded-md bg-slate-100 px-2 py-1">Scanner</span>
              <span className="rounded-md bg-slate-100 px-2 py-1">Watchlist</span>
              <span className="rounded-md bg-slate-100 px-2 py-1">Risk planner</span>
              <span className="rounded-md bg-slate-100 px-2 py-1">Journal</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="text-button" type="button" onClick={() => void loadAll()} title="Refresh data">
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={() => void importSample()}
              disabled={saving === "import"}
              title="Import sample scanner CSV"
            >
              <Upload className="h-4 w-4" />
              Import CSV
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] gap-4 px-4 py-4 sm:px-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Metric label="Scanner names" value={scanner.length.toString()} />
            <Metric label="Watchlist" value={watchlist.length.toString()} />
            <Metric label="Net P&L" value={currency(analytics.net_pnl)} tone={analytics.net_pnl >= 0 ? "good" : "bad"} />
            <Metric label="Win rate" value={`${number(analytics.win_rate, 1)}%`} />
          </div>

          {(error || notice) && (
            <div
              className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                error ? "border-red-200 bg-red-50 text-red-800" : "border-teal-200 bg-teal-50 text-teal-800"
              }`}
            >
              {error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>{error ?? notice}</span>
            </div>
          )}

          <section className="panel overflow-hidden rounded-md">
            <div className="flex flex-col gap-2 border-b border-line px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-ink">Scanner</h2>
              </div>
              {selectedSymbol && (
                <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                  <span className="rounded-md bg-slate-100 px-2 py-1">{selectedSymbol.ticker}</span>
                  <span className="rounded-md bg-slate-100 px-2 py-1">{selectedSymbol.label}</span>
                  <span className="rounded-md bg-slate-100 px-2 py-1">{selectedSymbol.above_vwap ? "Above VWAP" : "Below VWAP"}</span>
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-normal text-slate-500">
                  <tr>
                    <TableHead>Score</TableHead>
                    <TableHead>Ticker</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Gap</TableHead>
                    <TableHead>Rel vol</TableHead>
                    <TableHead>Float</TableHead>
                    <TableHead>Market cap</TableHead>
                    <TableHead>Spread</TableHead>
                    <TableHead>Catalyst</TableHead>
                    <TableHead>VWAP</TableHead>
                    <TableHead>Headline</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-slate-500" colSpan={13}>
                        Loading scanner...
                      </td>
                    </tr>
                  ) : (
                    scanner.map((symbol) => (
                      <tr
                        key={symbol.id}
                        className={`border-t border-line hover:bg-slate-50 ${
                          selectedTicker === symbol.ticker ? "bg-blue-50/60" : "bg-white"
                        }`}
                      >
                        <td className="px-3 py-3">
                          <span className={`inline-flex min-w-16 justify-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ${scoreTone(symbol.score)}`}>
                            {symbol.score}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <button
                            type="button"
                            className="font-semibold text-blue-700 hover:text-blue-900"
                            onClick={() => selectTicker(symbol)}
                          >
                            {symbol.ticker}
                          </button>
                        </td>
                        <td className="px-3 py-3">{currency(symbol.price)}</td>
                        <td className="px-3 py-3">{number(symbol.gap_pct, 1)}%</td>
                        <td className="px-3 py-3">{number(symbol.rel_volume, 1)}x</td>
                        <td className="px-3 py-3">{number(symbol.float_m, 1)}M</td>
                        <td className="px-3 py-3">{currency(symbol.market_cap_m)}M</td>
                        <td className={`px-3 py-3 ${symbol.spread_pct > 1.5 ? "font-semibold text-amber-700" : ""}`}>
                          {number(symbol.spread_pct, 1)}%
                        </td>
                        <td className="px-3 py-3">{symbol.catalyst_type || "None"}</td>
                        <td className="px-3 py-3">
                          <span className={symbol.above_vwap ? "text-teal-700" : "text-red-700"}>
                            {symbol.above_vwap ? "Above" : "Below"}
                          </span>
                        </td>
                        <td className="max-w-[280px] px-3 py-3 text-slate-700">
                          <span className="line-clamp-2">{symbol.news_headline || "No fresh catalyst"}</span>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusTone(symbol.status)}`}>
                            {symbol.status}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex gap-2">
                            <button
                              className="icon-button"
                              type="button"
                              title="Watch"
                              disabled={saving === `${symbol.ticker}-watch`}
                              onClick={() => void updateStatus(symbol.ticker, "watch")}
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            <button
                              className="icon-button"
                              type="button"
                              title="Ignore"
                              disabled={saving === `${symbol.ticker}-ignore`}
                              onClick={() => void updateStatus(symbol.ticker, "ignore")}
                            >
                              <EyeOff className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid gap-4 2xl:grid-cols-2">
            <PlannerPanel draft={planDraft} setDraft={setPlanDraft} onSubmit={savePlan} saving={saving === "plan"} plans={plans} />
            <JournalPanel
              draft={journalDraft}
              setDraft={setJournalDraft}
              onSubmit={saveJournal}
              saving={saving === "journal"}
              entries={journal}
            />
          </div>
        </section>

        <aside className="space-y-4">
          <RiskStatePanel state={riskState} settings={settings} />
          <WatchlistPanel
            items={watchlist}
            watchedTickers={watchedTickers}
            onSelect={(symbol) => selectTicker(symbol)}
            onRemove={removeWatchlistItem}
            saving={saving}
          />
          <CatalystPanel draft={catalystDraft} setDraft={setCatalystDraft} onSubmit={saveCatalyst} saving={saving === "catalyst"} />
          {riskDraft && (
            <RiskSettingsPanel draft={riskDraft} setDraft={setRiskDraft} onSubmit={saveRiskSettings} saving={saving === "settings"} />
          )}
          <AnalyticsPanel analytics={analytics} journal={journal} />
        </aside>
      </div>
    </main>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "bad" }) {
  const toneClass = tone === "good" ? "text-teal-700" : tone === "bad" ? "text-red-700" : "text-ink";
  return (
    <div className="panel rounded-md px-4 py-3">
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
}: {
  draft: PlanDraft;
  setDraft: React.Dispatch<React.SetStateAction<PlanDraft>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  plans: TradePlan[];
}) {
  return (
    <section className="panel rounded-md">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Calculator className="h-4 w-4 text-blue-700" />
        <h2 className="text-base font-semibold text-ink">Trade Planner</h2>
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
          <button className="primary-button w-full" type="submit" disabled={saving}>
            <Save className="h-4 w-4" />
            Save plan
          </button>
        </div>
      </form>
      <div className="border-t border-line">
        {plans.slice(0, 4).map((plan) => (
          <div key={plan.id} className="grid gap-2 border-b border-line px-4 py-3 text-sm last:border-b-0 sm:grid-cols-[1fr_auto]">
            <div>
              <div className="font-semibold text-ink">
                {plan.ticker} {plan.shares} shares
              </div>
              <div className="text-slate-500">
                Entry {currency(plan.entry_price)} / Stop {currency(plan.stop_price)} / Max loss {currency(plan.max_loss)}
              </div>
              {plan.warnings.length > 0 && <div className="mt-1 text-amber-700">{plan.warnings[0]}</div>}
            </div>
            <div className="text-right font-semibold text-slate-700">{plan.r_multiple ? `${number(plan.r_multiple, 2)}R` : "No target"}</div>
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
    <section className="panel rounded-md">
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
    <section className="panel rounded-md">
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
    <section className="panel rounded-md">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Eye className="h-4 w-4 text-blue-700" />
        <h2 className="text-base font-semibold text-ink">Watchlist</h2>
      </div>
      <div className="divide-y divide-line">
        {items.map((item) => (
          <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <button
              type="button"
              className="min-w-0 text-left"
              onClick={() => item.symbol && onSelect(item.symbol)}
              disabled={!item.symbol}
            >
              <div className="font-semibold text-ink">{item.ticker}</div>
              <div className="truncate text-sm text-slate-500">
                {item.symbol ? `${item.symbol.score} / ${item.symbol.label}` : "Manual watch"}
              </div>
            </button>
            <button
              className="icon-button shrink-0"
              type="button"
              title="Remove"
              disabled={saving === `remove-${item.ticker}`}
              onClick={() => void onRemove(item.ticker)}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {items.length === 0 && <div className="px-4 py-4 text-sm text-slate-500">No names on watch.</div>}
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
    <section className="panel rounded-md">
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
    <section className="panel rounded-md">
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
    <section className="panel overflow-hidden rounded-md">
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
