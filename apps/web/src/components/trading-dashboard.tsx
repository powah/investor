import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  BookOpen,
  Calculator,
  CheckCircle2,
  ChevronRight,
  CircleStop,
  Clock3,
  CloudDownload,
  ClipboardList,
  ExternalLink,
  Eye,
  EyeOff,
  LayoutDashboard,
  LockKeyhole,
  Newspaper,
  Play,
  Plus,
  PlugZap,
  Power,
  Radio,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Settings,
  Trash2,
  Unplug,
  Upload,
  WalletCards,
} from "lucide-react";
import { ApiError, currency, number } from "@/lib/api";
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
import type {
  AutomationDraft,
  PromotionDraft,
} from "@/modules/trading-dashboard/contracts";
import { httpTradingDashboardRemote } from "@/modules/trading-dashboard/http-remote";
import { JournalWorkspace, useJournalWorkspace } from "@/modules/trading-dashboard/journal/journal-workspace";
import { PlannerWorkspace, usePlannerWorkspace } from "@/modules/trading-dashboard/planner/planner-workspace";
import type { OperationsRemote, TradingDashboardRemote } from "@/modules/trading-dashboard/remote";
import { RiskStatePanel } from "@/modules/trading-dashboard/risk/risk-presentation";
import { RiskRulesWorkspace, useRiskRules } from "@/modules/trading-dashboard/risk/risk-rules-workspace";
import {
  ScannerWorkspace,
  useScannerWorkspace,
} from "@/modules/trading-dashboard/scanner/scanner-workspace";
import { useWatchlistWorkspace, WatchlistWorkspace } from "@/modules/trading-dashboard/watchlist/watchlist-workspace";
import type {
  AutomationSettings,
  BrokerStreamState,
  BrokerSync,
  ExecutionAction,
  ExecutionIntent,
  ExternalNewsEvent,
  IntegrationsStatus,
  IntegrationSyncResult,
  MarketDataSnapshot,
  ProviderConnectionStatus,
  RiskSettings,
  ScannerSymbol,
  TradePlan,
} from "@/types/trading";

type WorkspaceView = "scanner" | "watchlist" | "planner" | "journal" | "analytics" | "operations" | "settings";

type ExecutionReview = {
  blockers: string[];
  warnings: string[];
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
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
      setNotice(await watchlistWorkspace.remove(ticker, loadAll));
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
      setNotice(await watchlistWorkspace.saveNote(ticker, loadAll));
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
    setError(null);
    try {
      const message = await riskRules.save(loadAll);
      if (message) {
        setNotice(message);
      }
    } catch (settingsError) {
      setError(apiMessage(settingsError));
    }
  }

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      setNotice(await planner.save(loadAll));
    } catch (planError) {
      setError(apiMessage(planError));
    }
  }

  async function saveJournal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      setNotice(await journalWorkspace.save(loadAll));
    } catch (journalError) {
      setError(apiMessage(journalError));
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
          <Metric label="Scanner universe" value={scannerWorkspace.candidates.length.toString()} />
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
            <WatchlistWorkspace
              workspace={watchlistWorkspace}
              selectedTicker={selectedTicker}
              saving={saving}
              onSelect={selectTicker}
              onRemove={removeWatchlistItem}
              onSaveNote={saveWatchlistNote}
              candidatePresentation={
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
                  saving={saving}
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

function OperationsWorkspace({
  remote,
  plans,
  onWorkspaceRefresh,
}: {
  remote: OperationsRemote;
  plans: TradePlan[];
  onWorkspaceRefresh: () => Promise<void>;
}) {
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationsStatus | null>(null);
  const [marketSnapshots, setMarketSnapshots] = useState<MarketDataSnapshot[]>([]);
  const [newsEvents, setNewsEvents] = useState<ExternalNewsEvent[]>([]);
  const [automationSettings, setAutomationSettings] = useState<AutomationSettings | null>(null);
  const [automationDraft, setAutomationDraft] = useState<AutomationDraft | null>(null);
  const [executions, setExecutions] = useState<ExecutionIntent[]>([]);
  const [executionReviews, setExecutionReviews] = useState<Record<number, ExecutionReview>>({});
  const [brokerSync, setBrokerSync] = useState<BrokerSync | null>(null);
  const [brokerStream, setBrokerStream] = useState<BrokerStreamState | null>(null);
  const [promotionDrafts, setPromotionDrafts] = useState<Record<number, PromotionDraft>>({});
  const [killConfirmation, setKillConfirmation] = useState("");
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const killSwitchEngaged = automationSettings?.kill_switch_engaged ?? true;
  const paperOnly = automationSettings?.paper_only ?? true;
  const brokerReady = Boolean(
    integrationStatus?.broker.enabled &&
      integrationStatus.broker.verification_status === "available",
  );
  const executionByPlan = useMemo(
    () => new Map(executions.map((execution) => [execution.trade_plan_id, execution])),
    [executions],
  );
  const plansAwaitingPreparation = useMemo(
    () => plans.filter((plan) => !executionByPlan.has(plan.id)),
    [plans, executionByPlan],
  );

  useEffect(() => {
    void loadOperations();
    // Integration calls are deliberately isolated to this lazy-mounted view.
  }, []);

  async function loadOperations() {
    setLoading(true);
    const [statusResult, snapshotResult, newsResult, automationResult, executionResult, streamResult] =
      await Promise.allSettled([
        remote.getIntegrationsStatus(),
        remote.listMarketSnapshots(),
        remote.listExternalEvents(),
        remote.getAutomationSettings(),
        remote.listExecutions(),
        remote.getBrokerStream(),
      ]);

    const failures: string[] = [];
    if (statusResult.status === "fulfilled") {
      setIntegrationStatus(statusResult.value);
    } else {
      failures.push(`setup status: ${apiMessage(statusResult.reason)}`);
    }
    if (snapshotResult.status === "fulfilled") {
      setMarketSnapshots(snapshotResult.value);
    } else {
      failures.push(`market snapshots: ${apiMessage(snapshotResult.reason)}`);
    }
    if (newsResult.status === "fulfilled") {
      setNewsEvents(newsResult.value);
      setPromotionDrafts((current) => {
        const next = { ...current };
        newsResult.value.forEach((event) => {
          if (!next[event.id]) {
            next[event.id] = {
              catalyst_type: event.category || "Other",
              quality_score: "10",
            };
          }
        });
        return next;
      });
    } else {
      failures.push(`external events: ${apiMessage(newsResult.reason)}`);
    }
    if (automationResult.status === "fulfilled") {
      setAutomationSettings(automationResult.value);
      setAutomationDraft(toAutomationDraft(automationResult.value));
    } else {
      failures.push(`automation controls: ${apiMessage(automationResult.reason)}`);
    }
    if (executionResult.status === "fulfilled") {
      const normalizedExecutions: ExecutionIntent[] = [];
      const reviews: Record<number, ExecutionReview> = {};
      executionResult.value.forEach((item) => {
        const normalized = normalizeExecutionResponse(item);
        normalizedExecutions.push(normalized.intent);
        if (normalized.blockers.length || normalized.warnings.length) {
          reviews[normalized.intent.id] = {
            blockers: normalized.blockers,
            warnings: normalized.warnings,
          };
        }
      });
      setExecutions(normalizedExecutions);
      setExecutionReviews((current) => ({ ...current, ...reviews }));
    } else {
      failures.push(`paper order queue: ${apiMessage(executionResult.reason)}`);
    }
    if (streamResult.status === "fulfilled") {
      setBrokerStream(streamResult.value);
    } else {
      failures.push(`order event stream: ${apiMessage(streamResult.reason)}`);
    }

    setError(failures.length ? `Some operations data is unavailable — ${failures.join("; ")}` : null);
    setLoading(false);
  }

  async function syncMarketData() {
    setAction("market-sync");
    setError(null);
    try {
      const result = await remote.syncMarketData();
      setNotice(syncResultMessage(result, "Market data sync finished"));
      await loadOperations();
    } catch (syncError) {
      setError(apiMessage(syncError));
    } finally {
      setAction(null);
    }
  }

  async function probeCapabilities() {
    setAction("capability-probe");
    setError(null);
    try {
      await remote.probeCapabilities();
      setNotice("Alpaca read endpoints and configured feeds were tested and recorded.");
      await loadOperations();
    } catch (probeError) {
      setError(apiMessage(probeError));
    } finally {
      setAction(null);
    }
  }

  async function syncNews() {
    setAction("news-sync");
    setError(null);
    try {
      const result = await remote.syncNews();
      setNotice(syncResultMessage(result, "External event sync finished"));
      await loadOperations();
    } catch (syncError) {
      setError(apiMessage(syncError));
    } finally {
      setAction(null);
    }
  }

  async function promoteEvent(event: ExternalNewsEvent) {
    const draft = promotionDrafts[event.id] ?? {
      catalyst_type: event.category || "Other",
      quality_score: "10",
    };
    setAction(`promote-${event.id}`);
    setError(null);
    try {
      await remote.promoteExternalEvent(event.id, draft);
      setNotice(`${event.ticker} was promoted only after your catalyst review.`);
      await Promise.all([loadOperations(), onWorkspaceRefresh()]);
    } catch (promotionError) {
      setError(apiMessage(promotionError));
    } finally {
      setAction(null);
    }
  }

  async function saveAutomationSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!automationDraft) {
      return;
    }
    setAction("automation-settings");
    setError(null);
    try {
      const updated = await remote.updateAutomationSettings(automationDraft);
      setAutomationSettings(updated);
      setAutomationDraft(toAutomationDraft(updated));
      setNotice("Paper automation settings saved. The kill switch remains the final authority.");
    } catch (settingsError) {
      setError(apiMessage(settingsError));
    } finally {
      setAction(null);
    }
  }

  async function updateKillSwitch(engaged: boolean) {
    setAction("kill-switch");
    setError(null);
    try {
      const updated = await remote.updateKillSwitch(engaged, killConfirmation);
      setAutomationSettings(updated);
      setAutomationDraft(toAutomationDraft(updated));
      setKillConfirmation("");
      setNotice(
        engaged
          ? "Kill switch engaged. Paper order submission is paused."
          : "Kill switch released for paper trading only.",
      );
    } catch (killSwitchError) {
      setError(apiMessage(killSwitchError));
    } finally {
      setAction(null);
    }
  }

  async function syncBroker() {
    setAction("broker-sync");
    setError(null);
    try {
      const synced = await remote.syncBroker();
      setBrokerSync(synced);
      setNotice("Paper broker account, positions, and orders reconciled.");
      await loadOperations();
    } catch (brokerError) {
      setError(apiMessage(brokerError));
    } finally {
      setAction(null);
    }
  }

  function storeExecutionResponse(response: ExecutionIntent | ExecutionAction) {
    const normalized = normalizeExecutionResponse(response);
    setExecutions((current) => [
      normalized.intent,
      ...current.filter((item) => item.id !== normalized.intent.id),
    ]);
    setExecutionReviews((current) => ({
      ...current,
      [normalized.intent.id]: {
        blockers: normalized.blockers,
        warnings: normalized.warnings,
      },
    }));
    return normalized;
  }

  async function prepareExecution(plan: TradePlan) {
    setAction(`prepare-${plan.id}`);
    setError(null);
    try {
      const response = await remote.prepareExecution(plan.id);
      const normalized = storeExecutionResponse(response);
      setNotice(
        normalized.blockers.length
          ? `${plan.ticker} paper order prepared with blockers to resolve.`
          : `${plan.ticker} paper order prepared for review. Nothing was submitted.`,
      );
      await loadOperations();
    } catch (executionError) {
      setError(apiMessage(executionError));
    } finally {
      setAction(null);
    }
  }

  async function approveExecution(execution: ExecutionIntent) {
    setAction(`approve-${execution.id}`);
    setError(null);
    try {
      const response = await remote.approveExecution(execution.id);
      const normalized = storeExecutionResponse(response);
      setNotice(
        normalized.blockers.length
          ? `${executionTicker(execution, plans)} still has execution blockers.`
          : `${executionTicker(execution, plans)} approved for paper submission. It has not been sent yet.`,
      );
      await loadOperations();
    } catch (approvalError) {
      setError(apiMessage(approvalError));
    } finally {
      setAction(null);
    }
  }

  async function submitExecution(execution: ExecutionIntent) {
    setAction(`submit-${execution.id}`);
    setError(null);
    try {
      const response = await remote.submitExecution(execution.id);
      const normalized = storeExecutionResponse(response);
      const ticker = executionTicker(execution, plans);
      const status = normalized.intent.status;
      if (status === "submission_unknown") {
        setNotice(`${ticker} may have reached Alpaca, but the response was inconclusive. Do not retry; sync the paper account to reconcile it.`);
      } else if (status === "protection_failed") {
        setNotice(`${ticker} filled, but its protective order is not confirmed. Keep submissions paused and inspect the paper account now.`);
      } else if (status === "entry_filled_protected") {
        setNotice(`${ticker} filled in the paper account and broker protection is active.`);
      } else {
        const submittedStatuses = ["submitted", "accepted", "partially_filled", "filled"];
        setNotice(
          normalized.blockers.length || !submittedStatuses.includes(status)
            ? `${ticker} was not submitted. Review the current blockers.`
            : `${ticker} was sent to the Alpaca paper account.`,
        );
      }
      await loadOperations();
    } catch (submissionError) {
      setError(apiMessage(submissionError));
    } finally {
      setAction(null);
    }
  }

  async function runAutomation() {
    setAction("automation-run");
    setError(null);
    try {
      const result = await remote.runAutomation();
      setNotice(
        `Paper run processed ${result.processed}, submitted ${result.submitted}, reconciled ${result.reconciled}, failed ${result.failed}.`,
      );
      await loadOperations();
    } catch (runError) {
      setError(apiMessage(runError));
    } finally {
      setAction(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeading
        eyebrow="Feeds and paper execution"
        title="Operations"
        description="Bring in free external data, review it before it affects scoring, and move saved plans through a guarded Alpaca paper-order workflow."
      />

      <PaperOnlyBanner broker={integrationStatus?.broker ?? null} />

      {(error || notice) && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
            error ? "border-red-200 bg-red-50 text-red-800" : "border-teal-200 bg-teal-50 text-teal-800"
          }`}
          role={error ? "alert" : "status"}
          aria-live="polite"
        >
          {error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{error ?? notice}</span>
        </div>
      )}

      <section className="panel overflow-hidden rounded-xl" aria-labelledby="connection-status-heading">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 id="connection-status-heading" className="font-semibold text-ink">Setup status</h3>
            <p className="mt-1 text-sm text-slate-500">Credentials stay in server environment settings and are never shown here.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="text-button"
              type="button"
              disabled={
                loading ||
                action === "capability-probe" ||
                !integrationStatus?.market_data.configured
              }
              onClick={() => void probeCapabilities()}
            >
              <Radio
                className={`h-4 w-4 ${action === "capability-probe" ? "animate-pulse" : ""}`}
                aria-hidden="true"
              />
              {action === "capability-probe" ? "Testing access" : "Test Alpaca access"}
            </button>
            <button className="text-button" type="button" disabled={loading} onClick={() => void loadOperations()}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
              {loading ? "Checking" : "Refresh status"}
            </button>
          </div>
        </div>
        <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-5">
          <ConnectionCard title="Market data" connection={integrationStatus?.market_data ?? null} icon={Radio} />
          <ConnectionCard title="News" connection={integrationStatus?.news ?? null} icon={Newspaper} />
          <ConnectionCard title="SEC filings" connection={integrationStatus?.filings ?? null} icon={CloudDownload} />
          <ConnectionCard title="Paper broker" connection={integrationStatus?.broker ?? null} icon={WalletCards} />
          <BrokerStreamCard stream={brokerStream} />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <FeedOperationsPanel
          status={integrationStatus}
          snapshots={marketSnapshots}
          action={action}
          onSyncMarket={syncMarketData}
          onSyncNews={syncNews}
        />
        <AutomationSafetyPanel
          settings={automationSettings}
          draft={automationDraft}
          setDraft={setAutomationDraft}
          action={action}
          killSwitchEngaged={killSwitchEngaged}
          killConfirmation={killConfirmation}
          setKillConfirmation={setKillConfirmation}
          onSave={saveAutomationSettings}
          onKillSwitch={updateKillSwitch}
          onRun={runAutomation}
          brokerReady={brokerReady}
        />
      </div>

      <ExternalEventsPanel
        events={newsEvents}
        drafts={promotionDrafts}
        setDrafts={setPromotionDrafts}
        action={action}
        onPromote={promoteEvent}
      />

      <ExecutionWorkspace
        plans={plans}
        plansAwaitingPreparation={plansAwaitingPreparation}
        executions={executions}
        reviews={executionReviews}
        brokerSync={brokerSync}
        action={action}
        killSwitchEngaged={killSwitchEngaged}
        paperOnly={paperOnly}
        brokerReady={brokerReady}
        onBrokerSync={syncBroker}
        onPrepare={prepareExecution}
        onApprove={approveExecution}
        onSubmit={submitExecution}
      />
    </div>
  );
}

function toAutomationDraft(settings: AutomationSettings): AutomationDraft {
  return {
    enabled: settings.enabled,
    auto_submit_approved: settings.auto_submit_approved,
    require_manual_approval: settings.require_manual_approval,
    max_orders_per_day: String(settings.max_orders_per_day),
    max_order_notional: String(settings.max_order_notional),
    max_quote_age_seconds: String(settings.max_quote_age_seconds),
    max_price_deviation_pct: String(settings.max_price_deviation_pct),
  };
}

function normalizeExecutionResponse(value: ExecutionIntent | ExecutionAction): ExecutionAction {
  if ("intent" in value) {
    return value;
  }
  return { intent: value, blockers: [], warnings: [] };
}

function syncResultMessage(result: IntegrationSyncResult, prefix: string) {
  const details = result.results
    .map(
      (item) =>
        `${item.provider}: ${item.status}${item.records_count ? ` (${item.records_count})` : ""}${
          item.message ? ` — ${item.message}` : ""
        }`,
    )
    .join(" · ");
  return details ? `${prefix}. ${details}.` : `${prefix}.`;
}

function executionTicker(execution: ExecutionIntent, plans: TradePlan[]) {
  return plans.find((plan) => plan.id === execution.trade_plan_id)?.ticker ?? `Plan ${execution.trade_plan_id}`;
}

function formatOperationTime(value: string | null) {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

function optionalCurrency(value: number | null) {
  return value == null ? "—" : currency(value);
}

function optionalQuantity(value: number | null) {
  return value == null ? "—" : number(value, 4);
}

function marketFeedLabel(feed: string | null, isConsolidated = false, delaySeconds: number | null = null) {
  if (feed === "iex") {
    return "Real-time IEX · single venue";
  }
  if (feed === "delayed_sip") {
    return "15-min delayed SIP · consolidated";
  }
  if (feed === "sip") {
    return "Real-time SIP · paid access required";
  }
  if (delaySeconds && delaySeconds > 0) {
    return `${Math.round(delaySeconds / 60)}-min delayed${isConsolidated ? " · consolidated" : ""}`;
  }
  return isConsolidated ? "Consolidated market feed" : feed?.replaceAll("_", " ") || "Feed not selected";
}

function connectionLabel(connection: ProviderConnectionStatus) {
  if (connection.purpose === "market_data") {
    if (connection.source_feed === "sip" && !connection.enabled) {
      return "Real-time SIP requested · access unverified";
    }
    return marketFeedLabel(connection.source_feed, connection.is_consolidated, connection.real_time ? 0 : 900);
  }
  if (connection.purpose === "paper_broker") {
    return connection.environment === "paper" ? "Alpaca paper account" : "Paper account unavailable";
  }
  if (connection.provider === "sec_edgar") {
    return "Public SEC EDGAR feed";
  }
  return connection.real_time ? "Real-time entitlement" : "Free REST feed · freshness varies";
}

function PaperOnlyBanner({ broker }: { broker: ProviderConnectionStatus | null }) {
  const brokerReady = Boolean(
    broker?.enabled && broker.verification_status === "available",
  );
  return (
    <section className="overflow-hidden rounded-xl border border-teal-200 bg-teal-50" aria-label="Paper trading safety boundary">
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-teal-700 p-2 text-white">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-teal-950">Paper trading only</h3>
              <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-teal-800 ring-1 ring-teal-200">
                No live orders
              </span>
            </div>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-teal-900">
              Orders can only target the Alpaca paper environment. Paper fills are simulated but still change that account. Every order starts as a draft, warnings require acknowledgement, and submission remains behind the kill switch.
            </p>
            <p className="mt-1 max-w-4xl text-xs leading-5 text-teal-800">
              Local-use preview: there is no sign-in or network access control in this app yet. Keep it on your own computer and do not expose it to the internet or a shared network.
            </p>
          </div>
        </div>
        <div className="shrink-0 text-sm font-semibold text-teal-900">
          {brokerReady ? "Paper broker verified" : "Paper broker unavailable"}
        </div>
      </div>
    </section>
  );
}

function ConnectionCard({
  title,
  connection,
  icon: Icon,
}: {
  title: string;
  connection: ProviderConnectionStatus | null;
  icon: typeof Radio;
}) {
  const alpacaVerified = connection?.provider !== "alpaca" || connection.verification_status === "available";
  const ready = Boolean(connection?.configured && connection.enabled && alpacaVerified);
  const sipUnverified = Boolean(connection?.source_feed === "sip" && !connection.enabled);
  const configuredButUnavailable = Boolean(connection?.configured && !connection.enabled);
  const verifiedUnavailable = Boolean(
    connection?.verification_status === "unavailable" ||
      connection?.verification_status === "failed",
  );
  const notTested = Boolean(
    connection?.provider === "alpaca" &&
      connection.configured &&
      connection.verification_status === "not_tested",
  );
  return (
    <article className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className={`rounded-lg p-2 ${ready ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-500"}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${ready ? "bg-teal-50 text-teal-700" : "bg-amber-50 text-amber-800"}`}>
          {connection
            ? ready
              ? "Ready"
              : sipUnverified
                ? "Access unverified"
                : notTested
                  ? "Not tested"
                  : verifiedUnavailable
                    ? connection?.verification_status === "failed"
                      ? "Test failed"
                      : "Unavailable"
                : configuredButUnavailable
                  ? "Unavailable"
                  : "Needs setup"
            : "Checking"}
        </span>
      </div>
      <h4 className="mt-3 font-semibold text-ink">{title}</h4>
      <div className="mt-1 text-xs font-semibold text-slate-600">
        {connection ? connectionLabel(connection) : "Waiting for server status"}
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        {connection?.message ?? "This check runs only while Operations is open."}
      </p>
      {connection?.verification_message && (
        <p className="mt-2 border-t border-line pt-2 text-xs leading-5 text-slate-500">
          {connection.verification_message}
          {connection.verified_at ? ` Checked ${formatOperationTime(connection.verified_at)}.` : ""}
        </p>
      )}
    </article>
  );
}

function BrokerStreamCard({ stream }: { stream: BrokerStreamState | null }) {
  const listening = stream?.status === "listening";
  const label = stream ? stream.status.replaceAll("_", " ") : "checking";
  const lastActivity = stream?.last_event_at ?? stream?.last_backfill_at ?? stream?.last_connected_at;
  return (
    <article className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className={`rounded-lg p-2 ${listening ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-500"}`}>
          <Activity className="h-4 w-4" aria-hidden="true" />
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${listening ? "bg-teal-50 text-teal-700" : "bg-amber-50 text-amber-800"}`}>
          {label}
        </span>
      </div>
      <h4 className="mt-3 font-semibold text-ink">Order events</h4>
      <div className="mt-1 text-xs font-semibold text-slate-600">
        {stream ? `${stream.events_processed} applied · ${stream.duplicate_events} replays ignored` : "Waiting for worker status"}
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        {stream?.last_error
          ? stream.last_error
          : lastActivity
            ? `Last activity ${new Date(lastActivity).toLocaleString()}. REST recovery runs before every reconnect.`
            : "The worker durably records Alpaca paper order and fill updates before applying them."}
      </p>
    </article>
  );
}

function FeedOperationsPanel({
  status,
  snapshots,
  action,
  onSyncMarket,
  onSyncNews,
}: {
  status: IntegrationsStatus | null;
  snapshots: MarketDataSnapshot[];
  action: string | null;
  onSyncMarket: () => Promise<void>;
  onSyncNews: () => Promise<void>;
}) {
  const marketReady = Boolean(
    status?.market_data.enabled &&
      status.market_data.verification_status === "available",
  );
  const newsReady = Boolean(
    (status?.news.enabled && status.news.verification_status === "available") ||
      status?.filings.enabled,
  );
  return (
    <section className="panel overflow-hidden rounded-xl" aria-labelledby="feed-operations-heading">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <CloudDownload className="h-4 w-4 text-blue-700" aria-hidden="true" />
          <h3 id="feed-operations-heading" className="font-semibold text-ink">Free feed sync</h3>
        </div>
        <p className="mt-1 text-sm text-slate-500">Pull on demand while the free-source workflow is being validated.</p>
      </div>

      <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-slate-50 p-3">
          <div className="text-sm font-semibold text-ink">Market snapshots</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">
            {status?.market_data
              ? connectionLabel(status.market_data)
              : "Scanner sync uses the configured server-side feed."}
          </div>
          {status?.market_data.source_feed === "iex" && (
            <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs font-medium text-amber-900">
              IEX is one venue, not a consolidated spread or volume view.
            </div>
          )}
          {status?.market_data.source_feed === "sip" && !status.market_data.enabled && (
            <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs font-medium leading-5 text-amber-900">
              Real-time consolidated SIP is not part of the free setup. Sync stays disabled until paid access is configured and verified on the server.
            </div>
          )}
          <button
            className="primary-button mt-3 w-full"
            type="button"
            disabled={!marketReady || action === "market-sync"}
            onClick={() => void onSyncMarket()}
          >
            <RefreshCw className={`h-4 w-4 ${action === "market-sync" ? "animate-spin" : ""}`} aria-hidden="true" />
            {action === "market-sync" ? "Syncing market data" : "Sync market data"}
          </button>
        </div>

        <div className="rounded-xl border border-line bg-slate-50 p-3">
          <div className="text-sm font-semibold text-ink">News and SEC events</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">
            Imported items remain external events until you explicitly promote one.
          </div>
          <div className="mt-2 rounded-lg bg-blue-50 px-2.5 py-2 text-xs font-medium text-blue-900">
            Syncing never changes a scanner score by itself.
          </div>
          <button
            className="text-button mt-3 w-full justify-center"
            type="button"
            disabled={!newsReady || action === "news-sync"}
            onClick={() => void onSyncNews()}
          >
            <Newspaper className="h-4 w-4" aria-hidden="true" />
            {action === "news-sync" ? "Syncing events" : "Sync external events"}
          </button>
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-ink">Latest stored snapshots</h4>
          <span className="text-xs text-slate-500">{snapshots.length} symbols</span>
        </div>
        {snapshots.length ? (
          <div className="mt-3 overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.08em] text-slate-500">
                <tr>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Bid / ask</TableHead>
                  <TableHead>Volume / VWAP</TableHead>
                  <TableHead>Feed</TableHead>
                  <TableHead>As of</TableHead>
                </tr>
              </thead>
              <tbody>
                {snapshots.slice(0, 12).map((snapshot) => (
                  <tr key={snapshot.id} className="border-t border-line bg-white">
                    <td className="px-3 py-3 font-semibold text-ink">{snapshot.ticker}</td>
                    <td className="px-3 py-3 text-ink">{currency(snapshot.price)}</td>
                    <td className="px-3 py-3 text-slate-600">
                      {snapshot.bid == null || snapshot.ask == null
                        ? "—"
                        : `${currency(snapshot.bid)} / ${currency(snapshot.ask)}`}
                      <span className="block text-xs text-slate-400">
                        {snapshot.spread_pct == null ? "Spread unavailable" : `${number(snapshot.spread_pct, 2)}% spread`}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {snapshot.volume == null ? "—" : number(snapshot.volume, 0)}
                      <span className="block text-xs text-slate-400">
                        {snapshot.vwap == null ? "VWAP unavailable" : `${currency(snapshot.vwap)} VWAP`}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                        {marketFeedLabel(snapshot.source_feed, snapshot.is_consolidated, snapshot.delay_seconds)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500">{formatOperationTime(snapshot.event_time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-3 rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            No external snapshots stored yet. Sync when the market provider is ready.
          </div>
        )}
      </div>
    </section>
  );
}

function AutomationSafetyPanel({
  settings,
  draft,
  setDraft,
  action,
  killSwitchEngaged,
  killConfirmation,
  setKillConfirmation,
  onSave,
  onKillSwitch,
  onRun,
  brokerReady,
}: {
  settings: AutomationSettings | null;
  draft: AutomationDraft | null;
  setDraft: React.Dispatch<React.SetStateAction<AutomationDraft | null>>;
  action: string | null;
  killSwitchEngaged: boolean;
  killConfirmation: string;
  setKillConfirmation: (value: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onKillSwitch: (engaged: boolean) => Promise<void>;
  onRun: () => Promise<void>;
  brokerReady: boolean;
}) {
  function patch(update: Partial<AutomationDraft>) {
    setDraft((current) => (current ? { ...current, ...update } : current));
  }

  return (
    <section className="panel overflow-hidden rounded-xl" aria-labelledby="automation-safety-heading">
      <div className={`border-b px-4 py-4 ${killSwitchEngaged ? "border-amber-200 bg-amber-50" : "border-teal-200 bg-teal-50"}`}>
        <div className="flex items-start gap-3">
          <div className={`rounded-lg p-2 text-white ${killSwitchEngaged ? "bg-amber-700" : "bg-teal-700"}`}>
            {killSwitchEngaged ? <CircleStop className="h-5 w-5" aria-hidden="true" /> : <Power className="h-5 w-5" aria-hidden="true" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="automation-safety-heading" className="font-semibold text-ink">Kill switch</h3>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${killSwitchEngaged ? "bg-white text-amber-900" : "bg-white text-teal-800"}`}>
                {killSwitchEngaged ? "Engaged · submissions paused" : "Released · paper only"}
              </span>
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              {killSwitchEngaged
                ? "Safe default: prepared and approved orders cannot be submitted."
                : "Paper submission is armed, subject to every risk, quote-age, and approval check."}
            </p>
          </div>
        </div>

        {killSwitchEngaged ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-white p-3">
            <label className="block text-xs font-semibold text-slate-700" htmlFor="kill-switch-confirmation">
              Type ARM PAPER AUTOMATION to release
            </label>
            <input
              id="kill-switch-confirmation"
              className="field mt-1"
              value={killConfirmation}
              autoComplete="off"
              onChange={(event) => setKillConfirmation(event.target.value)}
            />
            <button
              className="text-button mt-2 w-full justify-center"
              type="button"
              disabled={
                killConfirmation !== "ARM PAPER AUTOMATION" ||
                action === "kill-switch" ||
                !settings?.paper_only ||
                !brokerReady
              }
              onClick={() => void onKillSwitch(false)}
            >
              <LockKeyhole className="h-4 w-4" aria-hidden="true" />
              Release for paper only
            </button>
          </div>
        ) : (
          <button
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            type="button"
            disabled={action === "kill-switch"}
            onClick={() => void onKillSwitch(true)}
          >
            <Unplug className="h-4 w-4" aria-hidden="true" />
            Engage kill switch now
          </button>
        )}
      </div>

      {draft ? (
        <form className="grid gap-3 p-4 sm:grid-cols-2" onSubmit={onSave}>
          <div className="sm:col-span-2">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-blue-700" aria-hidden="true" />
              <h4 className="text-sm font-semibold text-ink">Paper automation limits</h4>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">These settings cannot enable live trading. Limit orders with day duration are the only order path.</p>
          </div>
          <Field label="Orders per day">
            <input
              className="field"
              type="number"
              min="1"
              max="50"
              value={draft.max_orders_per_day}
              onChange={(event) => patch({ max_orders_per_day: event.target.value })}
            />
          </Field>
          <Field label="Max order value">
            <input
              className="field"
              type="number"
              min="1"
              step="0.01"
              value={draft.max_order_notional}
              onChange={(event) => patch({ max_order_notional: event.target.value })}
            />
          </Field>
          <Field label="Max quote age (seconds)">
            <input
              className="field"
              type="number"
              min="5"
              max="900"
              value={draft.max_quote_age_seconds}
              onChange={(event) => patch({ max_quote_age_seconds: event.target.value })}
            />
          </Field>
          <Field label="Max price drift %">
            <input
              className="field"
              type="number"
              min="0.01"
              max="25"
              step="0.01"
              value={draft.max_price_deviation_pct}
              onChange={(event) => patch({ max_price_deviation_pct: event.target.value })}
            />
          </Field>
          <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm text-slate-700 sm:col-span-2">
            <input
              className="mt-0.5"
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => patch({ enabled: event.target.checked })}
            />
            <span><strong className="block text-ink">Enable paper automation runs</strong><span className="mt-0.5 block text-xs leading-5 text-slate-500">The kill switch and broker checks still apply.</span></span>
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm text-slate-700 sm:col-span-2">
            <input
              className="mt-0.5"
              type="checkbox"
              checked={draft.require_manual_approval}
              disabled
              readOnly
            />
            <span><strong className="block text-ink">Manual approval required</strong><span className="mt-0.5 block text-xs leading-5 text-slate-500">Every prepared order must pass Review and Approve in this paper release.</span></span>
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm text-slate-700 sm:col-span-2">
            <input
              className="mt-0.5"
              type="checkbox"
              checked={draft.auto_submit_approved}
              onChange={(event) => patch({ auto_submit_approved: event.target.checked })}
            />
            <span><strong className="block text-ink">Submit already-approved paper orders during a run</strong><span className="mt-0.5 block text-xs leading-5 text-slate-500">This never bypasses approval, limits, or the kill switch.</span></span>
          </label>
          <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
            <button className="text-button justify-center" type="submit" disabled={action === "automation-settings"}>
              <Save className="h-4 w-4" aria-hidden="true" />
              Save automation limits
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={
                action === "automation-run" ||
                killSwitchEngaged ||
                !draft.enabled ||
                !brokerReady
              }
              onClick={() => void onRun()}
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              {action === "automation-run" ? "Running checks" : "Run paper automation"}
            </button>
          </div>
        </form>
      ) : (
        <div className="p-4 text-sm leading-6 text-slate-500">Automation controls are unavailable. Submission stays safely paused.</div>
      )}
    </section>
  );
}

function ExternalEventsPanel({
  events,
  drafts,
  setDrafts,
  action,
  onPromote,
}: {
  events: ExternalNewsEvent[];
  drafts: Record<number, PromotionDraft>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<number, PromotionDraft>>>;
  action: string | null;
  onPromote: (event: ExternalNewsEvent) => Promise<void>;
}) {
  function patch(event: ExternalNewsEvent, update: Partial<PromotionDraft>) {
    setDrafts((current) => ({
      ...current,
      [event.id]: {
        catalyst_type: current[event.id]?.catalyst_type ?? event.category ?? "Other",
        quality_score: current[event.id]?.quality_score ?? "10",
        ...update,
      },
    }));
  }

  return (
    <section className="panel overflow-hidden rounded-xl" aria-labelledby="external-events-heading">
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Newspaper className="h-4 w-4 text-blue-700" aria-hidden="true" />
            <h3 id="external-events-heading" className="font-semibold text-ink">External event inbox</h3>
          </div>
          <p className="mt-1 text-sm text-slate-500">Review source, category, and quality. Promotion is always explicit.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{events.length} stored</span>
      </div>
      {events.length ? (
        <div className="grid max-h-[760px] gap-3 overflow-y-auto p-3 lg:grid-cols-2">
          {events.map((event) => {
            const draft = drafts[event.id] ?? { catalyst_type: event.category || "Other", quality_score: "10" };
            const promoted = event.promoted_catalyst_id != null;
            return (
              <article key={event.id} className="rounded-xl border border-line bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-950 px-2 py-1 font-semibold text-white">{event.ticker}</span>
                    <span>{event.source}</span>
                    <span className="capitalize">{event.provider.replaceAll("_", " ")}</span>
                  </div>
                  <time dateTime={event.published_at}>{formatOperationTime(event.published_at)}</time>
                </div>
                <h4 className="mt-3 font-semibold leading-6 text-ink">{event.headline}</h4>
                {event.summary && <p className="mt-1 line-clamp-3 text-sm leading-6 text-slate-600">{event.summary}</p>}
                {event.url && (
                  <a
                    className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:text-blue-900"
                    href={event.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Review source <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                )}

                {promoted ? (
                  <div className="mt-4 flex items-center gap-2 rounded-lg bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-800">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Promoted to reviewed catalyst
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-blue-800">Human review required</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
                      <Field label="Catalyst type">
                        <input
                          className="field"
                          value={draft.catalyst_type}
                          onChange={(inputEvent) => patch(event, { catalyst_type: inputEvent.target.value })}
                        />
                      </Field>
                      <Field label="Quality / 20">
                        <input
                          className="field"
                          type="number"
                          min="0"
                          max="20"
                          step="1"
                          value={draft.quality_score}
                          onChange={(inputEvent) => patch(event, { quality_score: inputEvent.target.value })}
                        />
                      </Field>
                    </div>
                    <button
                      className="primary-button mt-3 w-full"
                      type="button"
                      disabled={
                        action === `promote-${event.id}` ||
                        !draft.catalyst_type.trim() ||
                        toNumber(draft.quality_score) < 0 ||
                        toNumber(draft.quality_score) > 20
                      }
                      onClick={() => void onPromote(event)}
                    >
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      {action === `promote-${event.id}` ? "Promoting" : "Promote after review"}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="px-4 py-12 text-center">
          <Newspaper className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
          <h4 className="mt-3 font-semibold text-ink">No external events yet</h4>
          <p className="mt-1 text-sm text-slate-500">Sync news and SEC filings, then review the inbox here.</p>
        </div>
      )}
    </section>
  );
}

function ExecutionWorkspace({
  plans,
  plansAwaitingPreparation,
  executions,
  reviews,
  brokerSync,
  action,
  killSwitchEngaged,
  paperOnly,
  brokerReady,
  onBrokerSync,
  onPrepare,
  onApprove,
  onSubmit,
}: {
  plans: TradePlan[];
  plansAwaitingPreparation: TradePlan[];
  executions: ExecutionIntent[];
  reviews: Record<number, ExecutionReview>;
  brokerSync: BrokerSync | null;
  action: string | null;
  killSwitchEngaged: boolean;
  paperOnly: boolean;
  brokerReady: boolean;
  onBrokerSync: () => Promise<void>;
  onPrepare: (plan: TradePlan) => Promise<void>;
  onApprove: (execution: ExecutionIntent) => Promise<void>;
  onSubmit: (execution: ExecutionIntent) => Promise<void>;
}) {
  return (
    <section className="panel overflow-hidden rounded-xl" aria-labelledby="paper-execution-heading">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-blue-700" aria-hidden="true" />
            <h3 id="paper-execution-heading" className="font-semibold text-ink">Paper execution queue</h3>
          </div>
          <p className="mt-1 text-sm text-slate-500">A saved plan never becomes an order without moving through each explicit stage.</p>
        </div>
        <button
          className="text-button"
          type="button"
          disabled={!brokerReady || action === "broker-sync"}
          onClick={() => void onBrokerSync()}
        >
          <RefreshCw className={`h-4 w-4 ${action === "broker-sync" ? "animate-spin" : ""}`} aria-hidden="true" />
          {action === "broker-sync" ? "Syncing paper account" : "Sync paper account"}
        </button>
      </div>

      <div className="grid grid-cols-3 border-b border-line bg-slate-50 text-center text-xs font-semibold text-slate-600">
        <div className="border-r border-line px-2 py-3"><span className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-950 text-white">1</span>Prepare</div>
        <div className="border-r border-line px-2 py-3"><span className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-blue-700 text-white">2</span>Review / approve</div>
        <div className="px-2 py-3"><span className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-teal-700 text-white">3</span>Submit to paper</div>
      </div>

      <div className="grid gap-5 p-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(330px,0.75fr)]">
        <div className="min-w-0 space-y-4">
          <div>
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-ink">Saved plans awaiting preparation</h4>
              <span className="text-xs text-slate-500">{plansAwaitingPreparation.length} available</span>
            </div>
            {plansAwaitingPreparation.length ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {plansAwaitingPreparation.slice(0, 8).map((plan) => (
                  <article key={plan.id} className="rounded-xl border border-line bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-ink">{plan.ticker} · {number(plan.shares, 0)} shares</div>
                        <div className="mt-1 text-xs text-slate-500">Limit {currency(plan.entry_price)} · stop {currency(plan.stop_price)}</div>
                      </div>
                      <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">Plan #{plan.id}</span>
                    </div>
                    {plan.warnings.length > 0 && (
                      <div className="mt-2 text-xs leading-5 text-amber-800">{plan.warnings.length} planning warning{plan.warnings.length === 1 ? "" : "s"} will carry into review.</div>
                    )}
                    <button
                      className="text-button mt-3 w-full justify-center"
                      type="button"
                      disabled={!brokerReady || action === `prepare-${plan.id}`}
                      onClick={() => void onPrepare(plan)}
                    >
                      <ClipboardList className="h-4 w-4" aria-hidden="true" />
                      {action === `prepare-${plan.id}` ? "Preparing checks" : "Prepare paper order"}
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-2 rounded-lg bg-slate-50 px-4 py-5 text-sm text-slate-500">
                {plans.length ? "Every saved plan already has an execution record." : "Save a valid trade plan before preparing a paper order."}
              </div>
            )}
          </div>

          <div className="border-t border-line pt-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-ink">Prepared and submitted orders</h4>
              <span className="text-xs text-slate-500">{executions.length} records</span>
            </div>
            {executions.length ? (
              <div className="mt-2 space-y-3">
                {executions.map((execution) => (
                  <ExecutionCard
                    key={execution.id}
                    execution={execution}
                    ticker={executionTicker(execution, plans)}
                    review={reviews[execution.id]}
                    action={action}
                    killSwitchEngaged={killSwitchEngaged}
                    paperOnly={paperOnly}
                    brokerReady={brokerReady}
                    onApprove={onApprove}
                    onSubmit={onSubmit}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-2 rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                No paper order has been prepared.
              </div>
            )}
          </div>
        </div>

        <PaperBrokerPanel brokerSync={brokerSync} brokerReady={brokerReady} />
      </div>
    </section>
  );
}

function ExecutionCard({
  execution,
  ticker,
  review,
  action,
  killSwitchEngaged,
  paperOnly,
  brokerReady,
  onApprove,
  onSubmit,
}: {
  execution: ExecutionIntent;
  ticker: string;
  review: ExecutionReview | undefined;
  action: string | null;
  killSwitchEngaged: boolean;
  paperOnly: boolean;
  brokerReady: boolean;
  onApprove: (execution: ExecutionIntent) => Promise<void>;
  onSubmit: (execution: ExecutionIntent) => Promise<void>;
}) {
  const blockers = uniqueStrings([
    ...(review?.blockers ?? []),
    ...recordStrings(execution.risk_snapshot, "blockers"),
    ...recordStrings(execution.quote_snapshot, "blockers"),
  ]);
  const warnings = uniqueStrings([
    ...(review?.warnings ?? []),
    ...recordStrings(execution.risk_snapshot, "warnings"),
    ...recordStrings(execution.risk_snapshot, "plan_warnings"),
    ...recordStrings(execution.quote_snapshot, "warnings"),
  ]);
  const normalizedStatus = execution.status.toLowerCase();
  const isApproved = [
    "approved",
    "submitting",
    "submission_unknown",
    "submitted",
    "accepted",
    "partially_filled",
    "entry_filled_protected",
    "protection_failed",
    "filled",
    "canceled",
    "expired",
    "done_for_day",
    "replaced",
    "rejected",
  ].includes(normalizedStatus);
  const isBrokerConfirmed = [
    "submitted",
    "accepted",
    "partially_filled",
    "entry_filled_protected",
    "protection_failed",
    "filled",
    "canceled",
    "expired",
    "done_for_day",
    "replaced",
    "rejected",
  ].includes(normalizedStatus);
  const canApprove = ["pending_approval", "prepared", "draft", "blocked"].includes(normalizedStatus) && blockers.length === 0;
  const canSubmit = normalizedStatus === "approved" && !killSwitchEngaged && paperOnly && brokerReady;
  const quoteFeed = recordText(execution.quote_snapshot, "source_feed") || recordText(execution.quote_snapshot, "feed");
  const quoteAge = recordNumber(execution.quote_snapshot, "quote_age_seconds") ?? recordNumber(execution.quote_snapshot, "age_seconds");

  return (
    <article className={`rounded-xl border bg-white p-4 ${normalizedStatus === "protection_failed" ? "border-red-300" : "border-line"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h5 className="font-semibold text-ink">{ticker}</h5>
            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${executionStatusTone(normalizedStatus)}`}>
              {executionStatusLabel(normalizedStatus)}
            </span>
            <span className="rounded-full bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800">Paper</span>
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {number(execution.quantity, 0)} shares · limit {currency(execution.limit_price)} · day order
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Stop reference {currency(execution.stop_price)}
            {execution.target_price == null ? "" : ` · target ${currency(execution.target_price)}`}
          </div>
          {(quoteFeed || quoteAge != null) && (
            <div className="mt-2 text-xs font-medium text-slate-600">
              Quote check: {quoteFeed ? marketFeedLabel(quoteFeed) : "feed recorded"}{quoteAge == null ? "" : ` · ${number(quoteAge, 0)}s old`}
            </div>
          )}
        </div>
        <div className="grid min-w-[210px] grid-cols-3 gap-1 text-center text-[11px] font-semibold">
          <ExecutionStep label="Prepared" complete />
          <ExecutionStep label="Approved" complete={isApproved} />
          <ExecutionStep label="Broker confirmed" complete={isBrokerConfirmed} />
        </div>
      </div>

      {normalizedStatus === "submission_unknown" && (
        <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950">
          <Clock3 className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Alpaca may have accepted this order, but the app did not receive a conclusive response. Do not submit it again. Use “Sync paper account” and let reconciliation match the existing client order ID.</span>
        </div>
      )}
      {normalizedStatus === "entry_filled_protected" && (
        <div className="mt-3 flex gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm leading-6 text-teal-900">
          <ShieldCheck className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>The paper entry filled and Alpaca reports an active protective exit. Continue syncing until the position closes.</span>
        </div>
      )}
      {normalizedStatus === "protection_failed" && (
        <div className="mt-3 flex gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium leading-6 text-red-900" role="alert">
          <AlertTriangle className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>The paper entry may be open without confirmed stop protection. Engage the kill switch, inspect the Alpaca paper account, and manage the position manually before continuing.</span>
        </div>
      )}

      {blockers.map((blocker) => (
        <div key={blocker} className="mt-2 flex gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{blocker}</span>
        </div>
      ))}
      {warnings.map((warning) => (
        <div key={warning} className="mt-2 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{warning}</span>
        </div>
      ))}
      {execution.failure_reason && (
        <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{execution.failure_reason}</div>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          className="text-button justify-center"
          type="button"
          disabled={!canApprove || action === `approve-${execution.id}`}
          onClick={() => void onApprove(execution)}
        >
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          {isApproved ? "Approved" : action === `approve-${execution.id}` ? "Reviewing" : warnings.length ? "Acknowledge & approve" : "Review & approve"}
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={!canSubmit || action === `submit-${execution.id}`}
          onClick={() => void onSubmit(execution)}
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          {executionSubmitLabel(
            normalizedStatus,
            killSwitchEngaged,
            paperOnly,
            brokerReady,
            action === `submit-${execution.id}`,
          )}
        </button>
      </div>
    </article>
  );
}

function ExecutionStep({ label, complete }: { label: string; complete: boolean }) {
  return (
    <div className={`rounded-lg px-2 py-2 ${complete ? "bg-teal-50 text-teal-800" : "bg-slate-100 text-slate-500"}`}>
      {complete ? <CheckCircle2 className="mx-auto mb-1 h-3.5 w-3.5" aria-hidden="true" /> : <Clock3 className="mx-auto mb-1 h-3.5 w-3.5" aria-hidden="true" />}
      {label}
    </div>
  );
}

function PaperBrokerPanel({ brokerSync, brokerReady }: { brokerSync: BrokerSync | null; brokerReady: boolean }) {
  if (!brokerSync) {
    return (
      <aside className="rounded-xl border border-line bg-slate-50 p-4">
        <WalletCards className="h-5 w-5 text-blue-700" aria-hidden="true" />
        <h4 className="mt-3 font-semibold text-ink">Paper account</h4>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          {brokerReady
            ? "Use “Sync paper account” to retrieve current balances, positions, and order states."
            : "Configure the Alpaca paper connection on the server. No account secrets are entered in this app."}
        </p>
      </aside>
    );
  }

  const accountBlocked = brokerSync.account.trading_blocked || brokerSync.account.account_blocked || brokerSync.account.trade_suspended_by_user;
  return (
    <aside className="space-y-3">
      <div className="rounded-xl border border-line bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="label">Alpaca environment</div>
            <div className="mt-1 font-semibold capitalize text-ink">{brokerSync.account.environment}</div>
          </div>
          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${accountBlocked ? "bg-red-50 text-red-800" : "bg-teal-50 text-teal-800"}`}>
            {accountBlocked ? "Trading blocked" : brokerSync.account.status}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <PreviewStat label="Equity" value={optionalCurrency(brokerSync.account.equity)} />
          <PreviewStat label="Buying power" value={optionalCurrency(brokerSync.account.buying_power)} />
          <PreviewStat label="Cash" value={optionalCurrency(brokerSync.account.cash)} />
          <PreviewStat label="Market" value={brokerSync.clock.is_open ? "Open" : "Closed"} />
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          Broker time {formatOperationTime(brokerSync.clock.timestamp)} · next {brokerSync.clock.is_open ? "close" : "open"} {formatOperationTime(brokerSync.clock.is_open ? brokerSync.clock.next_close : brokerSync.clock.next_open)}
        </p>
      </div>

      <div className="rounded-xl border border-line bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-ink">Paper positions</h4>
          <span className="text-xs text-slate-500">{brokerSync.positions.length}</span>
        </div>
        <div className="mt-2 space-y-2">
          {brokerSync.positions.slice(0, 8).map((position) => (
            <div key={position.symbol} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-ink">{position.symbol} · {number(position.quantity, 4)}</span>
                <span className={position.unrealized_pl != null && position.unrealized_pl < 0 ? "font-semibold text-red-700" : "font-semibold text-teal-700"}>
                  {optionalCurrency(position.unrealized_pl)}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Avg {optionalCurrency(position.average_entry_price)} · current {optionalCurrency(position.current_price)} · available {optionalQuantity(position.available_quantity)}
              </div>
            </div>
          ))}
          {!brokerSync.positions.length && <div className="text-sm text-slate-500">No open paper positions.</div>}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-ink">Recent paper orders</h4>
          <span className="text-xs text-slate-500">{brokerSync.orders.length}</span>
        </div>
        <div className="mt-2 space-y-2">
          {brokerSync.orders.slice(0, 8).map((order) => (
            <div key={order.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <div>
                <div className="font-semibold text-ink">{order.symbol || "Multi-leg order"} · {optionalQuantity(order.quantity)}</div>
                <div className="mt-1 text-xs uppercase text-slate-500">{order.order_type} · {order.time_in_force}</div>
              </div>
              <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold capitalize text-slate-700 ring-1 ring-slate-200">{order.status.replaceAll("_", " ")}</span>
            </div>
          ))}
          {!brokerSync.orders.length && <div className="text-sm text-slate-500">No paper orders returned.</div>}
        </div>
      </div>
    </aside>
  );
}

function executionStatusTone(status: string) {
  if (["filled", "entry_filled_protected", "accepted", "submitted", "approved"].includes(status)) {
    return "bg-teal-50 text-teal-800";
  }
  if (["protection_failed", "failed", "rejected", "canceled", "expired", "done_for_day", "replaced", "blocked"].includes(status)) {
    return "bg-red-50 text-red-800";
  }
  return "bg-amber-50 text-amber-800";
}

function executionStatusLabel(status: string) {
  if (status === "submission_unknown") {
    return "Submission unconfirmed";
  }
  if (status === "entry_filled_protected") {
    return "Entry filled · protection active";
  }
  if (status === "protection_failed") {
    return "Protection not confirmed";
  }
  return status.replaceAll("_", " ");
}

function executionSubmitLabel(
  status: string,
  killSwitchEngaged: boolean,
  paperOnly: boolean,
  brokerReady: boolean,
  isSubmitting: boolean,
) {
  if (status === "submission_unknown") {
    return "Awaiting reconciliation";
  }
  if (status === "entry_filled_protected") {
    return "Protection active";
  }
  if (status === "protection_failed") {
    return "Protection needs attention";
  }
  if (["submitted", "accepted", "partially_filled", "filled", "canceled", "expired", "done_for_day", "replaced", "rejected"].includes(status)) {
    return "Sent to paper account";
  }
  if (isSubmitting) {
    return "Submitting";
  }
  if (killSwitchEngaged) {
    return "Paused by kill switch";
  }
  if (!paperOnly) {
    return "Paper-only check failed";
  }
  if (!brokerReady) {
    return "Paper broker unavailable";
  }
  return "Submit to paper";
}

function recordStrings(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function recordText(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function recordNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" ? value : null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
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

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "bad" }) {
  const toneClass = tone === "good" ? "text-teal-700" : tone === "bad" ? "text-red-700" : "text-ink";
  return (
    <div className="panel rounded-xl px-4 py-3">
      <div className="label">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function PreviewStat({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className={`rounded-lg px-3 py-2 ${emphasize ? "bg-blue-50 ring-1 ring-blue-100" : "bg-slate-50"}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 ${emphasize ? "font-semibold text-blue-900" : "text-sm font-medium text-ink"}`}>{value}</div>
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
