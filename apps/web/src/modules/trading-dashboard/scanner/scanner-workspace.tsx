import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Eye, EyeOff, Play, RefreshCw, Search } from "lucide-react";
import { currency, number } from "@/lib/api";
import type { LegacyImport, ScannerSession, ScannerSessionSummary, ScannerSymbol } from "@/types/trading";

export type ScannerFilter = "all" | "qualified" | "watching" | "caution";

export type ScannerRemote = {
  listCandidates(): Promise<ScannerSymbol[]>;
  listLegacyImports(context: "operational" | "demo"): Promise<LegacyImport[]>;
  listSessions(offset?: number): Promise<ScannerSessionSummary[]>;
  getCurrentSession(): Promise<ScannerSession | null>;
  cancelSession(sessionId: number): Promise<ScannerSession>;
  getSession(sessionId: number): Promise<ScannerSession>;
  importSampleCandidates(): Promise<ScannerSymbol[]>;
  startSession(): Promise<ScannerSession>;
  importCandidatesCsv(file: File): Promise<ScannerSession>;
  updateCandidateStatus(ticker: string, status: ScannerSymbol["status"]): Promise<ScannerSymbol>;
};

export function filterScannerCandidates({
  candidates,
  search,
  filter,
  minimumScore,
  watchedTickers,
}: {
  candidates: ScannerSymbol[];
  search: string;
  filter: ScannerFilter;
  minimumScore: number;
  watchedTickers: ReadonlySet<string>;
}) {
  const query = search.trim().toLowerCase();
  return candidates.filter((symbol) => {
    const matchesQuery =
      !query ||
      symbol.ticker.toLowerCase().includes(query) ||
      (symbol.catalyst_type ?? "").toLowerCase().includes(query) ||
      (symbol.news_headline ?? "").toLowerCase().includes(query);
    if (!matchesQuery) {
      return false;
    }
    if (filter === "qualified") {
      return symbol.score >= minimumScore;
    }
    if (filter === "watching") {
      return watchedTickers.has(symbol.ticker);
    }
    if (filter === "caution") {
      return symbol.risk_warnings.length > 0;
    }
    return true;
  });
}

export function useScannerWorkspace(
  remote: ScannerRemote,
  {
    minimumScore,
    watchedTickers,
  }: {
    minimumScore: number;
    watchedTickers: ReadonlySet<string>;
  },
) {
  const [candidates, setCandidates] = useState<ScannerSymbol[]>([]);
  const [sessions, setSessions] = useState<ScannerSession[]>([]);
  const [sessionHistory, setSessionHistory] = useState<ScannerSessionSummary[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const historyPaginated = useRef(false);
  const loadingHistory = useRef(false);
  const [currentSessionVerified, setCurrentSessionVerified] = useState(false);
  const [currentSessionError, setCurrentSessionError] = useState<string | null>(null);
  const currentRequest = useRef(0);
  const [currentSession, setCurrentSession] = useState<ScannerSession | null>(null);
  const [inspectedSession, setInspectedSession] = useState<ScannerSession | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const inspectionRequest = useRef(0);
  const [legacyImports, setLegacyImports] = useState<LegacyImport[]>([]);
  const [legacyImportsError, setLegacyImportsError] = useState<string | null>(null);
  const [scannerView, setScannerView] = useState<"current" | "legacy">("current");
  const [legacyContext, setLegacyContext] = useState<"operational" | "demo">("operational");
  const [selectedTicker, setSelectedTicker] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ScannerFilter>("all");
  const [pendingActions, setPendingActions] = useState<ReadonlySet<string>>(() => new Set());

  const beginAction = useCallback((actionId: string) => {
    setPendingActions((current) => new Set(current).add(actionId));
  }, []);
  const endAction = useCallback((actionId: string) => {
    setPendingActions((current) => {
      const next = new Set(current);
      next.delete(actionId);
      return next;
    });
  }, []);

  const mergeHistoryPage = useCallback((history: ScannerSessionSummary[]) => {
    if (!historyPaginated.current) {
      setHasMoreHistory(history.length === 50);
    }
    setSessionHistory((previous) => [...history, ...previous.filter((item) => !history.some((entry) => entry.id === item.id))]);
  }, []);

  const refreshCurrentSession = useCallback(async (isCancelled: () => boolean = () => false) => {
    const request = ++currentRequest.current;
    try {
      const actionable = await remote.getCurrentSession();
      if (!isCancelled() && request === currentRequest.current) {
        setCurrentSession(actionable);
        setCurrentSessionVerified(true);
        setCurrentSessionError(null);
      }
    } catch {
      if (!isCancelled() && request === currentRequest.current) {
        setCurrentSessionVerified(false);
        setCurrentSessionError("Unable to verify the Actionable Current Session. Showing the last known result; refresh to retry.");
      }
    }
  }, [remote]);

  const load = useCallback(async () => {
    const [candidateData, sessionSummaries] = await Promise.all([
      remote.listCandidates(),
      remote.listSessions(),
      refreshCurrentSession(),
    ]);
    const displayedSummary =
      sessionSummaries.find((session) => session.status === "running") ?? sessionSummaries[0] ?? null;
    const sessionData = displayedSummary ? [await remote.getSession(displayedSummary.id)] : [];
    mergeHistoryPage(sessionSummaries);
    setCandidates(candidateData);
    setSessions(sessionData);
    setSelectedTicker((current) => current || candidateData[0]?.ticker || "");
    return candidateData;
  }, [mergeHistoryPage, refreshCurrentSession, remote]);

  const displayedSession = inspectedSession ?? sessions.find((session) => session.status === "running") ?? sessions[0] ?? null;
  const activeSessionId = sessions.find((session) => session.status === "running")?.id ?? null;

  useEffect(() => {
    const scannerSessionId = activeSessionId;
    let cancelled = false;
    let refreshPending = false;

    async function refreshScannerSession() {
      if (refreshPending) {
        return;
      }
      refreshPending = true;
      try {
        const [updated, history] = await Promise.allSettled([
          scannerSessionId === null ? Promise.resolve(null) : remote.getSession(scannerSessionId),
          remote.listSessions(),
          refreshCurrentSession(() => cancelled),
        ]);
        if (!cancelled) {
          const errors: string[] = [];
          if (history.status === "fulfilled") mergeHistoryPage(history.value);
          else errors.push(String(history.reason));
          if (updated.status === "fulfilled") {
            const session = updated.value;
            if (session) {
              setSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
              setInspectedSession((current) => current?.id === session.id ? session : current);
            }
          } else errors.push(String(updated.reason));
          setSessionError(errors.length ? errors.join("; ") : null);
        }
      } finally {
        refreshPending = false;
      }
    }

    const interval = window.setInterval(() => void refreshScannerSession(), scannerSessionId === null ? 15000 : 1000);
    void refreshScannerSession();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeSessionId, mergeHistoryPage, refreshCurrentSession, remote]);

  const inspectSession = useCallback(async (sessionId: number | null) => {
    const request = ++inspectionRequest.current;
    setSessionError(null);
    if (sessionId === null) {
      setInspectedSession(null);
      return;
    }
    try {
      const session = await remote.getSession(sessionId);
      if (request === inspectionRequest.current) setInspectedSession(session);
    } catch (error) {
      if (request === inspectionRequest.current) setSessionError(String(error));
    }
  }, [remote]);

  const loadMoreHistory = useCallback(async () => {
    if (!hasMoreHistory || loadingHistory.current) return;
    loadingHistory.current = true;
    beginAction("history-page");
    try {
      const older = await remote.listSessions(sessionHistory.length);
      historyPaginated.current = true;
      setHasMoreHistory(older.length === 50);
      setSessionHistory((current) => [...current, ...older.filter((item) => !current.some((entry) => entry.id === item.id))]);
    } catch (error) {
      setSessionError(String(error));
    } finally {
      loadingHistory.current = false;
      endAction("history-page");
    }
  }, [beginAction, endAction, hasMoreHistory, remote, sessionHistory.length]);

  const cancelSession = useCallback(async () => {
    if (activeSessionId === null) return;
    beginAction("cancel-session");
    setSessionError(null);
    try {
      const cancelled = await remote.cancelSession(activeSessionId);
      setSessions((current) => [cancelled, ...current.filter((item) => item.id !== cancelled.id)]);
      setInspectedSession((current) => current?.id === cancelled.id ? cancelled : current);
      await Promise.all([
        refreshCurrentSession(),
        remote.listSessions().then(mergeHistoryPage),
      ]);
    } catch (error) {
      setSessionError(String(error));
    } finally {
      endAction("cancel-session");
    }
  }, [activeSessionId, beginAction, endAction, mergeHistoryPage, refreshCurrentSession, remote]);

  const selectedCandidate = useMemo(
    () => candidates.find((candidate) => candidate.ticker === selectedTicker) ?? null,
    [candidates, selectedTicker],
  );
  const filteredCandidates = useMemo(
    () =>
      filterScannerCandidates({
        candidates,
        search,
        filter,
        minimumScore,
        watchedTickers,
      }),
    [candidates, filter, minimumScore, search, watchedTickers],
  );

  const selectCandidate = useCallback((candidate: ScannerSymbol) => {
    setSelectedTicker(candidate.ticker);
  }, []);

  const showLegacyImports = useCallback(async () => {
    const actionId = "legacy-imports";
    setScannerView("legacy");
    beginAction(actionId);
    setLegacyImportsError(null);
    try {
      setLegacyImports(await remote.listLegacyImports(legacyContext));
    } catch (error) {
      setLegacyImportsError(error instanceof Error ? error.message : "Legacy Imports could not be loaded.");
    } finally {
      endAction(actionId);
    }
  }, [beginAction, endAction, legacyContext, remote]);

  const showCurrentCandidates = useCallback(() => {
    setScannerView("current");
  }, []);

  const selectLegacyContext = useCallback(
    async (context: "operational" | "demo") => {
      const actionId = "legacy-imports";
      setLegacyContext(context);
      beginAction(actionId);
      setLegacyImportsError(null);
      try {
        setLegacyImports(await remote.listLegacyImports(context));
      } catch (error) {
        setLegacyImportsError(error instanceof Error ? error.message : "Legacy Imports could not be loaded.");
      } finally {
        endAction(actionId);
      }
    },
    [beginAction, endAction, remote],
  );

  const startSession = useCallback(async () => {
    const actionId = "scanner-session";
    beginAction(actionId);
    try {
      const activeBeforeStart = sessions.find((session) => session.status === "running") ?? null;
      const scannerSession = await remote.startSession();
      setSessions((current) => [scannerSession, ...current.filter((session) => session.id !== scannerSession.id)]);
      return activeBeforeStart?.id === scannerSession.id
        ? `Scanner Session #${scannerSession.id} is already running; showing its persisted progress.`
        : `Scanner Session #${scannerSession.id} started for ${scannerSession.trading_date}.`;
    } finally {
      endAction(actionId);
    }
  }, [beginAction, endAction, remote, sessions]);

  const importSample = useCallback(
    async (refresh: () => Promise<void>) => {
      const actionId = "import";
      beginAction(actionId);
      try {
        await remote.importSampleCandidates();
        await refresh();
        return "Sample scanner data imported.";
      } finally {
        endAction(actionId);
      }
    },
    [beginAction, endAction, remote],
  );

  const importCsv = useCallback(
    async (file: File, refresh: () => Promise<void>) => {
      const actionId = "csv-import";
      beginAction(actionId);
      try {
        const scannerSession = await remote.importCandidatesCsv(file);
        setSessions((current) => [scannerSession, ...current.filter((session) => session.id !== scannerSession.id)]);
        await refresh();
        return `${file.name} attached to Scanner Session #${scannerSession.id} as supplementary discovery.`;
      } finally {
        endAction(actionId);
      }
    },
    [beginAction, endAction, remote],
  );

  const updateStatus = useCallback(
    async (
      ticker: string,
      status: ScannerSymbol["status"],
      refresh: () => Promise<void>,
    ) => {
      const actionId = `${ticker}-${status}`;
      beginAction(actionId);
      try {
        await remote.updateCandidateStatus(ticker, status);
        await refresh();
        return status === "watch" ? `${ticker} saved to watchlist.` : `${ticker} marked ${status}.`;
      } finally {
        endAction(actionId);
      }
    },
    [beginAction, endAction, remote],
  );

  return {
    candidates,
    sessions,
    sessionHistory,
    hasMoreHistory,
    currentSessionVerified,
    currentSessionError,
    currentSession,
    inspectedSession,
    sessionError,
    activeSessionId,
    inspectSession,
    cancelSession,
    loadMoreHistory,
    legacyImports,
    legacyImportsError,
    scannerView,
    legacyContext,
    selectedTicker,
    selectedCandidate,
    displayedSession,
    filteredCandidates,
    search,
    setSearch,
    filter,
    setFilter,
    pendingActions,
    load,
    selectCandidate,
    showLegacyImports,
    showCurrentCandidates,
    selectLegacyContext,
    startSession,
    importSample,
    importCsv,
    updateStatus,
  };
}

export type ScannerWorkspaceController = ReturnType<typeof useScannerWorkspace>;

export function ScannerWorkspace({
  workspace,
  loading,
  watchedTickers,
  maxSpreadPct,
  onRun,
  onSelect,
  onToggleWatch,
  onIgnore,
  candidateResearch,
}: {
  workspace: ScannerWorkspaceController;
  loading: boolean;
  watchedTickers: Set<string>;
  maxSpreadPct: number;
  onRun: () => Promise<void>;
  onSelect: (symbol: ScannerSymbol) => void;
  onToggleWatch: (symbol: ScannerSymbol) => Promise<void>;
  onIgnore: (symbol: ScannerSymbol) => Promise<void>;
  candidateResearch: ReactNode;
}) {
  const showingLegacyImports = workspace.scannerView === "legacy";
  return (
    <div className={`grid gap-5 ${showingLegacyImports ? "" : "xl:grid-cols-[minmax(0,1fr)_380px]"}`}>
      <div className="min-w-0 space-y-4">
        <PageHeading
          eyebrow="Step 1 · Discover"
          title="Scanner"
          description="Prioritize catalyst-driven movers, then inspect the score and risk evidence before watching a name."
        />
        <div className="flex gap-2" aria-label="Scanner data views">
          <button
            className={showingLegacyImports ? "text-button" : "secondary-active-button"}
            type="button"
            aria-pressed={!showingLegacyImports}
            onClick={workspace.showCurrentCandidates}
          >
            Current research
          </button>
          <button
            className={showingLegacyImports ? "secondary-active-button" : "text-button"}
            type="button"
            aria-pressed={showingLegacyImports}
            onClick={() => void workspace.showLegacyImports()}
          >
            Legacy Imports
          </button>
        </div>
        {showingLegacyImports ? (
          <LegacyImportsView workspace={workspace} />
        ) : (
          <>
            <section className="panel rounded-xl p-4" aria-label="Actionable Current Session">
              <h3 className="font-semibold">{!workspace.currentSessionVerified
                ? `Actionable Current Session unverified${workspace.currentSession ? ` · Last known #${workspace.currentSession.id}` : ""}`
                : workspace.currentSession
                ? `Actionable Current Session #${workspace.currentSession.id}`
                : "No Actionable Current Session"}</h3>
              <p className="text-sm text-slate-600">{workspace.currentSession
                ? `${workspace.currentSession.trading_date} · ${workspace.currentSession.market_phase.replaceAll("_", " ")} · ${workspace.currentSession.candidates.length} Candidates · Last refresh ${new Date(workspace.currentSession.completed_at!).toLocaleString()}`
                : workspace.currentSessionVerified
                  ? "No completed Scanner Session satisfies currentness rules. Historical attempts remain available for inspection."
                  : "Currentness has not been verified. Historical attempts remain available for inspection."}</p>
              {workspace.currentSessionError && <p role="alert">{workspace.currentSessionError}</p>}
              {workspace.currentSession && <ul className="mt-2 flex flex-wrap gap-3" aria-label="Actionable Current Session Candidates">
                {workspace.currentSession.candidates.map((candidate) => <li key={candidate.id}>
                  {candidate.observed_listings[0]?.ticker ?? candidate.security.issuer_name ?? candidate.security.identifier}
                </li>)}
              </ul>}
              <label className="mt-3 block text-sm">Inspect attempt
                <select aria-label="Inspect attempt" className="ml-2 rounded border p-2"
                  value={workspace.inspectedSession?.id ?? ""}
                  onChange={(event) => void workspace.inspectSession(event.target.value ? Number(event.target.value) : null)}>
                  <option value="">Latest attempt</option>
                  {workspace.sessionHistory.map((session) => <option key={session.id} value={session.id}>
                    #{session.id} · {session.trading_date} · {session.market_phase} · {session.status}
                  </option>)}
                </select>
              </label>
              {workspace.hasMoreHistory && <button type="button" disabled={workspace.pendingActions.has("history-page")} className="text-button" onClick={() => void workspace.loadMoreHistory()}>Load older attempts</button>}
              {workspace.inspectedSession && <p className="mt-2 text-sm text-amber-800">Historical inspection only. Selecting an attempt does not change the Actionable Current Session.</p>}
              {workspace.activeSessionId !== null && <button type="button" className="text-button"
                disabled={workspace.pendingActions.has("cancel-session")} onClick={() => void workspace.cancelSession()}>Cancel active run</button>}
              {workspace.sessionError && <p role="alert">{workspace.sessionError}</p>}
            </section>
            <ScannerSessionPanel
              scannerSession={workspace.displayedSession}
              starting={workspace.pendingActions.has("scanner-session")}
              onRun={onRun}
            />
            <ScannerToolbar
              search={workspace.search}
              setSearch={workspace.setSearch}
              filter={workspace.filter}
              setFilter={workspace.setFilter}
              resultCount={workspace.filteredCandidates.length}
            />
            <ScannerTable
              symbols={workspace.filteredCandidates}
              loading={loading}
              selectedTicker={workspace.selectedTicker}
              watchedTickers={watchedTickers}
              pendingActions={workspace.pendingActions}
              maxSpreadPct={maxSpreadPct}
              onSelect={onSelect}
              onToggleWatch={onToggleWatch}
              onIgnore={onIgnore}
            />
          </>
        )}
      </div>
      {!showingLegacyImports && candidateResearch}
    </div>
  );
}

function LegacyImportsView({ workspace }: { workspace: ScannerWorkspaceController }) {
  const unknown = (value: string | null) => value ?? "Unknown";
  return (
    <section className="panel overflow-hidden rounded-xl" aria-label="Legacy Imports reference view">
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-ink">Legacy Imports</h3>
          <p className="mt-1 text-sm font-medium text-amber-800">Reference only · Not actionable</p>
          <p className="mt-1 text-xs text-slate-500">
            Retained from the pre-session scanner. These rows cannot become Candidates or enter the Focus View.
          </p>
        </div>
        <div className="flex gap-2" aria-label="Legacy Import context">
          {(["operational", "demo"] as const).map((context) => (
            <button
              key={context}
              className={`rounded-lg px-3 py-2 text-xs font-semibold capitalize ${
                workspace.legacyContext === context ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600"
              }`}
              type="button"
              aria-pressed={workspace.legacyContext === context}
              disabled={workspace.pendingActions.has("legacy-imports")}
              onClick={() => void workspace.selectLegacyContext(context)}
            >
              {context === "operational" ? "Operational imports" : "Demo imports"}
            </button>
          ))}
        </div>
      </div>
      {workspace.pendingActions.has("legacy-imports") ? (
        <div className="px-4 py-12 text-center text-sm text-slate-500">Loading Legacy Imports…</div>
      ) : workspace.legacyImportsError ? (
        <div className="px-4 py-12 text-center text-sm text-red-700" role="alert">{workspace.legacyImportsError}</div>
      ) : workspace.legacyImports.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-slate-500">No Legacy Imports in this context.</div>
      ) : (
        <div className="divide-y divide-line">
          {workspace.legacyImports.map((item) => (
            <article key={item.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold text-blue-800">{item.ticker}</span>
                    <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                      {item.label}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{item.news_headline ?? "No headline retained"}</p>
                </div>
                <div className="text-right text-sm">
                  <div className="font-semibold text-ink">{currency(item.price)}</div>
                  <div className="text-xs text-slate-500">Original state: {item.legacy_status}</div>
                </div>
              </div>
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <LegacyFact label="Gap" value={`${number(item.gap_pct, 1)}%`} />
                <LegacyFact label="Relative volume" value={`${number(item.rel_volume, 1)}×`} />
                <LegacyFact label="Float" value={`${number(item.float_m, 1)}M`} />
                <LegacyFact label="Market cap" value={`${number(item.market_cap_m, 1)}M`} />
                <LegacyFact label="Spread" value={`${number(item.spread_pct, 1)}%`} />
                <LegacyFact label="Catalyst type" value={item.catalyst_type ?? "None retained"} />
                <LegacyFact label="Above VWAP" value={item.above_vwap ? "Yes" : "No"} />
                <LegacyFact label="Chart room" value={item.clean_daily_chart_room ? "Yes" : "No"} />
                <LegacyFact label="Holding key level" value={item.holding_key_level ? "Yes" : "No"} />
                <LegacyFact label="No dilution flag" value={item.no_dilution_red_flag ? "Yes" : "No"} />
                <LegacyFact label="Data origin" value={item.data_origin} />
                <LegacyFact label="Original created" value={new Date(item.original_created_at).toLocaleString()} />
                <LegacyFact label="Original updated" value={new Date(item.original_updated_at).toLocaleString()} />
                <LegacyFact label="Trading Date" value={unknown(item.trading_date)} />
                <LegacyFact label="Market Phase" value={unknown(item.market_phase)} />
                <LegacyFact label="Source provenance" value={unknown(item.source_provenance)} />
                <LegacyFact label="Source timestamp" value={unknown(item.source_timestamp)} />
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function LegacyFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-slate-800">{value}</dd>
    </div>
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

function TableHead({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-3 font-semibold">{children}</th>;
}

function ScannerSessionPanel({
  scannerSession,
  starting,
  onRun,
}: {
  scannerSession: ScannerSession | null;
  starting: boolean;
  onRun: () => Promise<void>;
}) {
  const phaseLabel = scannerSession?.market_phase.replace("_", " ") ?? "Not assigned";
  const statusClasses =
    scannerSession?.status === "completed"
      ? "bg-teal-50 text-teal-800 ring-teal-200"
      : scannerSession?.status === "failed" || scannerSession?.status === "cancelled"
        ? "bg-red-50 text-red-800 ring-red-200"
        : scannerSession?.status === "partial"
          ? "bg-amber-50 text-amber-800 ring-amber-200"
          : "bg-blue-50 text-blue-800 ring-blue-200";

  return (
    <section className="panel rounded-xl p-4" aria-label="Scanner Session run control">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-ink">
              {scannerSession ? `Scanner Session #${scannerSession.id}` : "No Scanner Session yet"}
            </h3>
            {scannerSession && (
              <span className={`rounded-full px-2 py-1 text-xs font-semibold capitalize ring-1 ring-inset ${statusClasses}`}>
                {scannerSession.status}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {scannerSession
              ? `${scannerSession.trading_date} · ${phaseLabel} · ${scannerSession.stage.replaceAll("_", " ")}`
              : "Start an immutable attempt with a fixed U.S. exchange-session identity."}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            This panel inspects an attempt. Running, partial, failed, and cancelled Candidates are not actionable. Repeating Run scanner while active returns the same Scanner Session.
          </p>
        </div>
        <button
          className="button-primary inline-flex shrink-0 items-center justify-center gap-2"
          type="button"
          disabled={starting}
          onClick={() => void onRun()}
        >
          {starting ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          {starting ? "Starting…" : "Run scanner"}
        </button>
      </div>

      {scannerSession && (
        <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span className="capitalize">{scannerSession.stage.replaceAll("_", " ")}</span>
              <span>{scannerSession.progress.percent}%</span>
            </div>
            <div
              className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-label="Scanner Session progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={scannerSession.progress.percent}
            >
              <div
                className={`h-full rounded-full ${scannerSession.status === "failed" ? "bg-red-500" : "bg-blue-600"}`}
                style={{ width: `${scannerSession.progress.percent}%` }}
              />
            </div>
          </div>

          <div className="grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
            <span>Started {new Date(scannerSession.started_at).toLocaleString()}</span>
            <span>{scannerSession.scanner_policy_version}</span>
            <span>{scannerSession.scoring_model_version}</span>
          </div>

          <div className="space-y-2" aria-label="Required-source diagnostics">
            {scannerSession.diagnostics.map((diagnostic) => (
              <div
                key={`${diagnostic.capability}-${diagnostic.source}`}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  diagnostic.status === "failed" || diagnostic.status === "unavailable"
                    ? "border-red-200 bg-red-50 text-red-900"
                    : "border-slate-200 bg-slate-50 text-slate-700"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold capitalize">{diagnostic.capability.replaceAll("_", " ")}</span>
                  <span className="text-xs font-semibold uppercase tracking-wide">{diagnostic.status}</span>
                </div>
                <p className="mt-1 text-xs">
                  {diagnostic.message ?? `${diagnostic.source} · ${diagnostic.required ? "required" : "supplementary"}`}
                </p>
                {diagnostic.details.data_tier === "delayed_consolidated" && (
                  <div className="mt-2 space-y-1 text-xs" aria-label="Market-Movement Discovery source contract">
                    <p className="font-semibold">Delayed consolidated bars · Not real-time</p>
                    <p>
                      Coverage: {String(diagnostic.details.coverage ?? "Unknown")} · Expected delay: {Number(diagnostic.details.expected_delay_seconds) / 60} minutes
                    </p>
                    <p>
                      Listings scanned: {String(diagnostic.details.eligible_listings ?? "Unknown")} · Symbols with bars: {String(diagnostic.details.symbols_with_bars ?? "Unknown")} / {String(diagnostic.details.requested_symbols ?? "Unknown")}
                    </p>
                    <p>Observed: {String(diagnostic.details.observed_at ?? "Unknown")}</p>
                    <p>Latest provider event: {String(diagnostic.details.provider_event_at ?? "No bars returned")}</p>
                  </div>
                )}
                {diagnostic.code && <p className="mt-1 text-xs font-medium">Diagnostic: {diagnostic.code}</p>}
                {Object.keys(diagnostic.details).length > 0 && (
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-white/70 p-2 text-[11px] leading-5 text-slate-700">
                    {JSON.stringify(diagnostic.details, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
          <SessionDiscoveryDetails scannerSession={scannerSession} />
        </div>
      )}
    </section>
  );
}

function SessionDiscoveryDetails({ scannerSession }: { scannerSession: ScannerSession }) {
  if (scannerSession.discovery_hits.length === 0) {
    return scannerSession.status === "completed" ? (
      <p className="text-sm text-slate-600">Discovery completed with no hits · 0 Candidates.</p>
    ) : null;
  }
  const outcomeTone = {
    admitted: "bg-teal-50 text-teal-800 ring-teal-200",
    rejected: "bg-red-50 text-red-800 ring-red-200",
    unresolved: "bg-amber-50 text-amber-800 ring-amber-200",
  };
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section aria-label="Discovery Hits">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Discovery Hits ({scannerSession.discovery_hits.length})
        </h4>
        <div className="mt-2 space-y-2">
          {scannerSession.discovery_hits.map((hit) => (
            <article key={hit.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-ink">{hit.ticker}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ring-1 ring-inset ${outcomeTone[hit.admission_outcome]}`}>
                  {hit.admission_outcome}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-700">{hit.discovery_reason}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                {hit.observed_listing.exchange ?? "Exchange unknown"} · {hit.observed_listing.instrument_type?.replaceAll("_", " ") ?? "Instrument unknown"}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">{hit.source} · {hit.source_reference}</p>
              <p className="mt-1 text-[11px] text-slate-500">{hit.admission_reasons.map((reason) => reason.replaceAll("_", " ")).join(" · ")}</p>
            </article>
          ))}
        </div>
      </section>
      <section aria-label="Admitted Candidates">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Candidates ({scannerSession.candidates.length})
        </h4>
        <div className="mt-2 space-y-2">
          {scannerSession.candidates.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">No admitted Candidates.</p>
          ) : scannerSession.candidates.map((candidate) => (
            <article key={candidate.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              <div className="font-semibold text-ink">{[...new Set(candidate.observed_listings.map((listing) => listing.ticker))].join(", ")}</div>
              <p className="mt-1 text-xs text-slate-600">
                {candidate.security.issuer_name ?? candidate.security.identifier} · {candidate.discovery_sources.join(" + ")}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">{candidate.discovery_reasons.join(" · ")}</p>
            </article>
          ))}
        </div>
      </section>
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
  pendingActions,
  maxSpreadPct,
  onSelect,
  onToggleWatch,
  onIgnore,
}: {
  symbols: ScannerSymbol[];
  loading: boolean;
  selectedTicker: string;
  watchedTickers: Set<string>;
  pendingActions: ReadonlySet<string>;
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
                        disabled={pendingActions.has(`${symbol.ticker}-watch`) || pendingActions.has(`${symbol.ticker}-candidate`)}
                        onClick={() => void onToggleWatch(symbol)}
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                        {watched ? "Watching" : "Watch"}
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Ignore ${symbol.ticker}`}
                        disabled={pendingActions.has(`${symbol.ticker}-ignore`)}
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
                <div className="flex items-center gap-2">
                  <button
                    className={watched ? "secondary-active-button" : "icon-button"}
                    type="button"
                    aria-label={watched ? `Remove ${symbol.ticker} from watchlist` : `Add ${symbol.ticker} to watchlist`}
                    aria-pressed={watched}
                    disabled={pendingActions.has(`${symbol.ticker}-watch`) || pendingActions.has(`${symbol.ticker}-candidate`)}
                    onClick={() => void onToggleWatch(symbol)}
                  >
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={`Ignore ${symbol.ticker}`}
                    disabled={pendingActions.has(`${symbol.ticker}-ignore`)}
                    onClick={() => void onIgnore(symbol)}
                  >
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
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
