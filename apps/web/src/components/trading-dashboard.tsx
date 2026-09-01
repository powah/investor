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
  Play,
  Plus,
  PlugZap,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Settings,
  Trash2,
  Upload,
} from "lucide-react";
import { EquityChart } from "@/components/equity-chart";
import { ApiError, currency, number, todayIsoDate } from "@/lib/api";
import { calculatePlanPreview, type PlanDraft, type PlanPreview } from "@/lib/plan-preview";
import {
  CandidateDetailPanel,
  CandidateResearchPanel,
  useCandidateResearch,
} from "@/modules/trading-dashboard/candidate-research/candidate-research";
import type { JournalDraft, RiskDraft } from "@/modules/trading-dashboard/contracts";
import { httpTradingDashboardRemote } from "@/modules/trading-dashboard/http-remote";
import { OperationsWorkspace } from "@/modules/trading-dashboard/operations-workspace";
import type { TradingDashboardRemote } from "@/modules/trading-dashboard/remote";
import {
  ScannerWorkspace,
  useScannerWorkspace,
} from "@/modules/trading-dashboard/scanner/scanner-workspace";
import type {
  Analytics,
  JournalEntry,
  RiskSettings,
  RiskState,
  ScannerSymbol,
  TradePlan,
  WatchlistItem,
} from "@/types/trading";

type WorkspaceView = "scanner" | "watchlist" | "planner" | "journal" | "analytics" | "operations" | "settings";

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

function toNumber(value: string) {
  return Number(value);
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
  { id: "operations", label: "Operations", description: "Feeds and paper orders", icon: PlugZap },
  { id: "settings", label: "Risk rules", description: "Set guardrails", icon: Settings },
];

export function LegacyTradingDashboard(
  { remote = httpTradingDashboardRemote }: { remote?: TradingDashboardRemote } = {},
) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [activeView, setActiveView] = useState<WorkspaceView>("scanner");
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [settings, setSettings] = useState<RiskSettings | null>(null);
  const [riskDraft, setRiskDraft] = useState<RiskDraft | null>(null);
  const [riskState, setRiskState] = useState<RiskState | null>(null);
  const [plans, setPlans] = useState<TradePlan[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [analytics, setAnalytics] = useState<Analytics>(emptyAnalytics);
  const [watchNotes, setWatchNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
  const scannerWorkspace = useScannerWorkspace(remote.scanner, {
    minimumScore: settings?.min_score_to_plan ?? 65,
    watchedTickers,
  });
  const candidateResearch = useCandidateResearch(
    remote.candidateResearch,
    scannerWorkspace.selectedTicker,
  );
  const selectedTicker = scannerWorkspace.selectedTicker;
  const selectedSymbol = scannerWorkspace.selectedCandidate;
  const selectedCatalysts = candidateResearch.selectedCatalysts;
  const selectedWatchItem = useMemo(
    () => watchlist.find((item) => item.ticker === selectedTicker) ?? null,
    [watchlist, selectedTicker],
  );
  const planPreview = useMemo(
    () => calculatePlanPreview(planDraft, selectedSymbol, settings, riskState),
    [planDraft, selectedSymbol, settings, riskState],
  );

  async function loadAll() {
    setError(null);
    const [scannerData, , watchlistData, settingsData, riskStateData, planData, journalData, analyticsData] =
      await Promise.all([
        scannerWorkspace.load(),
        candidateResearch.load(),
        remote.watchlist.listItems(),
        remote.riskRules.getSettings(),
        remote.riskRules.getState(),
        remote.planner.listPlans(),
        remote.journal.listEntries(),
        remote.analytics.getSummary(),
      ]);

    setWatchlist(watchlistData);
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
    if (!scannerWorkspace.selectedTicker && firstTicker) {
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
    scannerWorkspace.selectCandidate(symbol);
    candidateResearch.selectCandidate(symbol);
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
      setNotice(await scannerWorkspace.importSample(loadAll));
    } catch (importError) {
      setError(apiMessage(importError));
    } finally {
      setSaving(null);
    }
  }

  async function runScanner() {
    setSaving("scanner-session");
    setError(null);
    try {
      setNotice(await scannerWorkspace.startSession());
    } catch (scannerError) {
      setError(apiMessage(scannerError));
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
      setNotice(await scannerWorkspace.importCsv(file, loadAll));
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
      setNotice(await scannerWorkspace.updateStatus(ticker, status, loadAll));
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
      await remote.watchlist.removeItem(ticker);
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
      await remote.watchlist.saveNotes(ticker, watchNotes[ticker] || "");
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
    const symbol = scannerWorkspace.candidates.find((item) => item.ticker === plan.ticker) ?? null;
    if (symbol) {
      scannerWorkspace.selectCandidate(symbol);
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
      setNotice(await candidateResearch.saveReview(loadAll));
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
      await remote.riskRules.updateSettings(riskDraft);
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
      await remote.planner.createPlan(planDraft);
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
      await remote.journal.createEntry(journalDraft);
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
          <Metric label="Scanner universe" value={scannerWorkspace.candidates.length.toString()} />
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
            <ScannerWorkspace
              workspace={scannerWorkspace}
              loading={loading}
              saving={saving}
              watchedTickers={watchedTickers}
              maxSpreadPct={settings?.max_spread_pct ?? 1.5}
              onRun={runScanner}
              onSelect={selectTicker}
              onToggleWatch={toggleWatch}
              onIgnore={(symbol) => updateStatus(symbol.ticker, "ignore")}
              candidateResearch={
                <CandidateResearchPanel
                  research={candidateResearch}
                  symbol={selectedSymbol}
                  isWatched={Boolean(selectedSymbol && watchedTickers.has(selectedSymbol.ticker))}
                  saving={saving}
                  onToggleWatch={toggleWatch}
                  onPlan={startPlan}
                  onSubmit={saveCatalyst}
                />
              }
            />
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

          {activeView === "operations" && (
            <OperationsWorkspace remote={remote.operations} plans={plans} onWorkspaceRefresh={loadAll} />
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
