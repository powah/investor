import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Calculator,
  CheckCircle2,
  Eye,
  LayoutDashboard,
  PlugZap,
  RefreshCw,
  Settings,
  Upload,
} from "lucide-react";
import { ApiError, currency } from "@/lib/api";
import {
  AnalyticsSummaryPanel,
  AnalyticsWorkspace,
  useAnalyticsWorkspace,
} from "@/modules/trading-dashboard/analytics/analytics-workspace";
import {
  CandidateDetailPanel,
  CandidateResearchPanel,
  useCandidateResearch,
} from "@/modules/trading-dashboard/candidate-research/candidate-research";
import type { AnalyticsRemote } from "@/modules/trading-dashboard/analytics/analytics-workspace";
import type { CandidateResearchRemote } from "@/modules/trading-dashboard/candidate-research/candidate-research";
import { httpTradingDashboard } from "@/modules/trading-dashboard/http-trading-dashboard";
import { JournalWorkspace, useJournalWorkspace } from "@/modules/trading-dashboard/journal/journal-workspace";
import type { JournalRemote } from "@/modules/trading-dashboard/journal/journal-workspace";
import { OperationsWorkspace, type OperationsRemote } from "@/modules/trading-dashboard/operations-workspace";
import { PlannerWorkspace, usePlannerWorkspace } from "@/modules/trading-dashboard/planner/planner-workspace";
import type { PlannerRemote } from "@/modules/trading-dashboard/planner/planner-workspace";
import { RiskStatePanel } from "@/modules/trading-dashboard/risk/risk-presentation";
import { RiskRulesWorkspace, useRiskRules } from "@/modules/trading-dashboard/risk/risk-rules-workspace";
import type { RiskRulesRemote } from "@/modules/trading-dashboard/risk/risk-rules-workspace";
import {
  ScannerWorkspace,
  useScannerWorkspace,
} from "@/modules/trading-dashboard/scanner/scanner-workspace";
import type { ScannerRemote } from "@/modules/trading-dashboard/scanner/scanner-workspace";
import { useWatchlistWorkspace, WatchlistWorkspace } from "@/modules/trading-dashboard/watchlist/watchlist-workspace";
import type { WatchlistRemote } from "@/modules/trading-dashboard/watchlist/watchlist-workspace";
import type {
  RiskSettings,
  ScannerSymbol,
  TradePlan,
} from "@/types/trading";

type WorkspaceView = "scanner" | "watchlist" | "planner" | "journal" | "analytics" | "operations" | "settings";

type TradingDashboardDependencies = {
  scanner: ScannerRemote;
  candidateResearch: CandidateResearchRemote;
  watchlist: WatchlistRemote;
  riskRules: RiskRulesRemote;
  planner: PlannerRemote;
  journal: JournalRemote;
  analytics: AnalyticsRemote;
  operations: OperationsRemote;
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

export function TradingDashboard(
  { remote = httpTradingDashboard }: { remote?: TradingDashboardDependencies } = {},
) {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [activeView, setActiveView] = useState<WorkspaceView>("scanner");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const watchlistWorkspace = useWatchlistWorkspace(remote.watchlist);
  const watchedTickers = watchlistWorkspace.watchedTickers;
  const journalWorkspace = useJournalWorkspace(remote.journal);
  const analyticsWorkspace = useAnalyticsWorkspace(remote.analytics);
  const journal = journalWorkspace.entries;
  const analytics = analyticsWorkspace.summary;
  const riskRules = useRiskRules(remote.riskRules);
  const settings = riskRules.settings;
  const riskState = riskRules.state;
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
  const planner = usePlannerWorkspace(
    remote.planner,
    selectedSymbol,
    settings,
    riskState,
  );

  async function loadAll() {
    setError(null);
    const [scannerData, , , riskData] =
      await Promise.all([
        scannerWorkspace.load(),
        candidateResearch.load(),
        watchlistWorkspace.load(),
        riskRules.load(),
        planner.load(),
        journalWorkspace.load(),
        analyticsWorkspace.load(),
      ]);

    const firstTicker = scannerData[0]?.ticker ?? "";
    if (!scannerWorkspace.selectedTicker && firstTicker) {
      selectTicker(scannerData[0], riskData.settings);
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
    planner.selectCandidate(symbol, riskSettings);
    journalWorkspace.selectCandidate(symbol);
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

  async function report(task: () => Promise<string | null | void>) {
    setError(null);
    try {
      const message = await task();
      if (message) {
        setNotice(message);
      }
    } catch (actionError) {
      setError(apiMessage(actionError));
    }
  }

  async function importSample() {
    await report(() => scannerWorkspace.importSample(loadAll));
  }

  async function runScanner() {
    await report(scannerWorkspace.startSession);
  }

  async function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    await report(async () => {
      const message = await scannerWorkspace.importCsv(file, loadAll);
      setActiveView("scanner");
      return message;
    });
  }

  async function updateStatus(ticker: string, status: ScannerSymbol["status"]) {
    await report(() => scannerWorkspace.updateStatus(ticker, status, loadAll));
  }

  async function toggleWatch(symbol: ScannerSymbol) {
    await updateStatus(symbol.ticker, watchedTickers.has(symbol.ticker) ? "candidate" : "watch");
  }

  async function removeWatchlistItem(ticker: string) {
    await report(() => watchlistWorkspace.remove(ticker, loadAll));
  }

  async function saveWatchlistNote(ticker: string) {
    await report(() => watchlistWorkspace.saveNote(ticker, loadAll));
  }

  function startPlan(symbol: ScannerSymbol) {
    selectTicker(symbol);
    setActiveView("planner");
    setNotice(`${symbol.ticker} loaded into the risk planner. Define the stop before sizing.`);
  }

  function navigateTo(view: WorkspaceView) {
    if (view === "watchlist") {
      watchlistWorkspace.ensureWatchedSelection(selectedTicker, selectTicker);
    }
    setActiveView(view);
  }

  function startJournalFromPlan(plan: TradePlan) {
    const symbol = scannerWorkspace.candidates.find((item) => item.ticker === plan.ticker) ?? null;
    if (symbol) {
      scannerWorkspace.selectCandidate(symbol);
    }
    journalWorkspace.startFromPlan(plan, symbol);
    setActiveView("journal");
    setNotice(`${plan.ticker} plan loaded into the journal. Add the actual exit and review execution.`);
  }

  async function saveCatalyst(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await report(() => candidateResearch.saveReview(loadAll));
  }

  async function saveRiskSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await report(() => riskRules.save(loadAll));
  }

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await report(() => planner.save(loadAll));
  }

  async function saveJournal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await report(() => journalWorkspace.save(loadAll));
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
              <button className="text-button" type="button" onClick={() => void importSample()} disabled={scannerWorkspace.pendingActions.has("import")}>
                <Activity className="h-4 w-4" aria-hidden="true" />
                Load demo
              </button>
              <input ref={importInputRef} hidden type="file" accept=".csv,text/csv" tabIndex={-1} onChange={(event) => void importCsv(event)} />
              <button className="primary-button" type="button" onClick={() => importInputRef.current?.click()} disabled={scannerWorkspace.pendingActions.has("csv-import")}>
                <Upload className="h-4 w-4" aria-hidden="true" />
                {scannerWorkspace.pendingActions.has("csv-import") ? "Importing" : "Import CSV"}
              </button>
            </div>
          </div>

          <nav className="mt-4 overflow-x-auto" aria-label="Trading workspace">
            <div className="flex min-w-max gap-1" role="tablist" aria-label="Workflow views">
              {workspaceNavigation.map((item) => {
                const Icon = item.icon;
                const selected = activeView === item.id;
                const badge = item.id === "watchlist" ? watchlistWorkspace.items.length : item.id === "journal" ? journal.length : null;
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
          <Metric label="Actionable Current Session" value={!scannerWorkspace.currentSessionVerified ? "Unverified" : scannerWorkspace.currentSession ? `#${scannerWorkspace.currentSession.id}` : "None"} />
          <Metric label="Active watchlist" value={watchlistWorkspace.items.length.toString()} />
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
                  pendingActions={scannerWorkspace.pendingActions}
                  onToggleWatch={toggleWatch}
                  onPlan={startPlan}
                  onSubmit={saveCatalyst}
                />
              }
            />
          )}

          {activeView === "watchlist" && (
            <WatchlistWorkspace
              workspace={watchlistWorkspace}
              selectedTicker={selectedTicker}
              onSelect={selectTicker}
              onRemove={removeWatchlistItem}
              onSaveNote={saveWatchlistNote}
              candidatePresentation={
                <aside className="space-y-4 xl:sticky xl:top-[158px] xl:self-start">
                  <CandidateDetailPanel
                    symbol={selectedSymbol}
                    catalysts={selectedCatalysts}
                    isWatched={Boolean(selectedSymbol && watchedTickers.has(selectedSymbol.ticker))}
                    pendingActions={scannerWorkspace.pendingActions}
                    onToggleWatch={toggleWatch}
                    onPlan={startPlan}
                  />
                  <RiskStatePanel state={riskState} settings={settings} />
                </aside>
              }
            />
          )}

          {activeView === "planner" && (
            <PlannerWorkspace
              planner={planner}
              onSubmit={savePlan}
              onJournal={startJournalFromPlan}
              candidatePresentation={
                <CandidateDetailPanel
                  symbol={selectedSymbol}
                  catalysts={selectedCatalysts}
                  isWatched={Boolean(selectedSymbol && watchedTickers.has(selectedSymbol.ticker))}
                  pendingActions={scannerWorkspace.pendingActions}
                  onToggleWatch={toggleWatch}
                  onPlan={startPlan}
                  compact
                />
              }
              riskPresentation={<RiskStatePanel state={riskState} settings={settings} />}
            />
          )}

          {activeView === "journal" && (
            <JournalWorkspace
              journal={journalWorkspace}
              onSubmit={saveJournal}
              analyticsPresentation={
                <AnalyticsSummaryPanel analytics={analytics} journal={journal} />
              }
              riskPresentation={<RiskStatePanel state={riskState} settings={settings} />}
            />
          )}

          {activeView === "analytics" && (
            <AnalyticsWorkspace analytics={analyticsWorkspace} entries={journal} />
          )}

          {activeView === "operations" && (
            <OperationsWorkspace remote={remote.operations} plans={planner.plans} onWorkspaceRefresh={loadAll} />
          )}

          {activeView === "settings" && (
            <RiskRulesWorkspace risk={riskRules} onSubmit={saveRiskSettings} />
          )}
        </section>
      </div>
    </main>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "bad" }) {
  const toneClass = tone === "good" ? "text-teal-700" : tone === "bad" ? "text-red-700" : "text-ink";
  return (
    <div className="panel rounded-xl px-4 py-3">
      <div className="label">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
