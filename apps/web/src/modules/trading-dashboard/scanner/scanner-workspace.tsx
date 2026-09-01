import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Eye, EyeOff, Play, RefreshCw, Search } from "lucide-react";
import { currency, number } from "@/lib/api";
import type { ScannerSession, ScannerSymbol } from "@/types/trading";

export type ScannerFilter = "all" | "qualified" | "watching" | "caution";

export type ScannerRemote = {
  listCandidates(): Promise<ScannerSymbol[]>;
  listSessions(): Promise<ScannerSession[]>;
  getSession(sessionId: number): Promise<ScannerSession>;
  importSampleCandidates(): Promise<ScannerSymbol[]>;
  startSession(): Promise<ScannerSession>;
  importCandidatesCsv(file: File): Promise<ScannerSymbol[]>;
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

  const load = useCallback(async () => {
    const [candidateData, sessionData] = await Promise.all([
      remote.listCandidates(),
      remote.listSessions(),
    ]);
    setCandidates(candidateData);
    setSessions(sessionData);
    setSelectedTicker((current) => current || candidateData[0]?.ticker || "");
    return candidateData;
  }, [remote]);

  const displayedSession = sessions.find((session) => session.status === "running") ?? sessions[0] ?? null;
  const activeSessionId = displayedSession?.status === "running" ? displayedSession.id : null;

  useEffect(() => {
    if (activeSessionId === null) {
      return;
    }
    const scannerSessionId = activeSessionId;
    let cancelled = false;
    let refreshPending = false;

    async function refreshScannerSession() {
      if (refreshPending) {
        return;
      }
      refreshPending = true;
      try {
        const updated = await remote.getSession(scannerSessionId);
        if (!cancelled) {
          setSessions((current) => [updated, ...current.filter((session) => session.id !== updated.id)]);
        }
      } catch {
        // Keep the last persisted progress visible; the normal workspace refresh reports connectivity errors.
      } finally {
        refreshPending = false;
      }
    }

    const interval = window.setInterval(() => void refreshScannerSession(), 1000);
    void refreshScannerSession();
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeSessionId, remote]);

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
        await remote.importCandidatesCsv(file);
        await refresh();
        return `${file.name} imported into the scanner.`;
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
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <PageHeading
          eyebrow="Step 1 · Discover"
          title="Scanner"
          description="Prioritize catalyst-driven movers, then inspect the score and risk evidence before watching a name."
        />
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
      </div>
      {candidateResearch}
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
            Repeating this action while a run is active returns the same Scanner Session.
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
                {diagnostic.code && <p className="mt-1 text-xs font-medium">Diagnostic: {diagnostic.code}</p>}
                {Object.keys(diagnostic.details).length > 0 && (
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-white/70 p-2 text-[11px] leading-5 text-slate-700">
                    {JSON.stringify(diagnostic.details, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
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
