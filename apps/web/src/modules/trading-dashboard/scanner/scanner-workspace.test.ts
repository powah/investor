import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ScannerWorkspace,
  filterScannerCandidates,
  useScannerWorkspace,
  type ScannerRemote,
  type ScannerWorkspaceController,
} from "@/modules/trading-dashboard/scanner/scanner-workspace";
import { buildCandidate } from "@/test/fixtures";
import type { LegacyImport, ScannerSession, ScannerSessionSummary, ScannerSymbol } from "@/types/trading";

function buildSession(overrides: Partial<ScannerSession> = {}): ScannerSession {
  return {
    id: 1,
    status: "running",
    stage: "market_movement_discovery",
    started_at: "2026-08-09T08:00:00Z",
    completed_at: null,
    trading_date: "2026-08-09",
    market_phase: "premarket",
    scanner_policy_version: "scanner-v1",
    scanner_policy_settings: {},
    scoring_model_version: "score-v1",
    progress: { completed: 0, total: 4, percent: 0 },
    diagnostics: [],
    discovery_hits: [],
    candidates: [],
    ...overrides,
  };
}

function buildSessionSummary(overrides: Partial<ScannerSessionSummary> = {}): ScannerSessionSummary {
  const session = buildSession();
  return {
    id: session.id,
    status: session.status,
    stage: session.stage,
    started_at: session.started_at,
    completed_at: session.completed_at,
    trading_date: session.trading_date,
    market_phase: session.market_phase,
    scanner_policy_version: session.scanner_policy_version,
    scoring_model_version: session.scoring_model_version,
    progress: session.progress,
    diagnostics_count: 0,
    discovery_hits_count: 0,
    candidates_count: 0,
    ...overrides,
  };
}

function buildWorkspace(candidate: ScannerSymbol, action: string | null = null): ScannerWorkspaceController {
  return {
    candidates: [candidate],
    sessions: [],
    sessionHistory: [],
    currentSession: null,
    inspectedSession: null,
    sessionError: null,
    activeSessionId: null,
    inspectSession: vi.fn(),
    cancelSession: vi.fn(),
    loadMoreHistory: vi.fn(),
    legacyImports: [],
    legacyImportsError: null,
    scannerView: "current",
    legacyContext: "operational",
    selectedTicker: candidate.ticker,
    selectedCandidate: candidate,
    displayedSession: buildSession({ status: "completed", stage: "completed" }),
    filteredCandidates: [candidate],
    search: "",
    setSearch: vi.fn(),
    filter: "all",
    setFilter: vi.fn(),
    pendingActions: new Set(action ? [action] : []),
    load: vi.fn(),
    selectCandidate: vi.fn(),
    showLegacyImports: vi.fn(),
    showCurrentCandidates: vi.fn(),
    selectLegacyContext: vi.fn(),
    startSession: vi.fn(),
    importSample: vi.fn(),
    importCsv: vi.fn(),
    updateStatus: vi.fn(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("filterScannerCandidates", () => {
  const qualified = buildCandidate({ ticker: "ALFA", score: 82 });
  const watched = buildCandidate({ id: 2, ticker: "BETA", score: 60 });
  const caution = buildCandidate({ id: 3, ticker: "GAMMA", score: 70, risk_warnings: ["Wide spread"] });
  const candidates = [qualified, watched, caution];

  test("preserves search, score, watch, and caution filter semantics", () => {
    expect(
      filterScannerCandidates({
        candidates,
        search: "beta",
        filter: "all",
        minimumScore: 80,
        watchedTickers: new Set(["BETA"]),
      }).map((candidate) => candidate.ticker),
    ).toEqual(["BETA"]);

    expect(
      filterScannerCandidates({
        candidates,
        search: "",
        filter: "qualified",
        minimumScore: 80,
        watchedTickers: new Set(["BETA"]),
      }).map((candidate) => candidate.ticker),
    ).toEqual(["ALFA"]);

    expect(
      filterScannerCandidates({
        candidates,
        search: "",
        filter: "watching",
        minimumScore: 80,
        watchedTickers: new Set(["BETA"]),
      }).map((candidate) => candidate.ticker),
    ).toEqual(["BETA"]);

    expect(
      filterScannerCandidates({
        candidates,
        search: "",
        filter: "caution",
        minimumScore: 80,
        watchedTickers: new Set(["BETA"]),
      }).map((candidate) => candidate.ticker),
    ).toEqual(["GAMMA"]);
  });
});

describe("scanner workspace", () => {
  test("shows Legacy Imports as reference-only evidence without Candidate actions", async () => {
    const user = userEvent.setup();
    const legacyImport: LegacyImport = {
      id: 1,
      label: "Legacy Import",
      reference_only: true,
      actionable: false,
      ticker: "KEEP",
      price: 2.35,
      gap_pct: 42,
      rel_volume: 18.4,
      float_m: 8.2,
      market_cap_m: 21,
      spread_pct: 0.9,
      catalyst_type: "FDA",
      above_vwap: true,
      news_headline: "Known headline",
      clean_daily_chart_room: true,
      holding_key_level: false,
      no_dilution_red_flag: true,
      legacy_status: "watch",
      data_origin: "manual_import",
      original_created_at: "2026-07-31T10:00:00Z",
      original_updated_at: "2026-07-31T10:05:00Z",
      source_provenance: null,
      trading_date: null,
      market_phase: null,
      source_timestamp: null,
    };
    const remote: ScannerRemote = {
      listCandidates: vi.fn().mockResolvedValue([buildCandidate()]),
      listLegacyImports: vi.fn().mockResolvedValue([legacyImport]),
      getCurrentSession: vi.fn().mockResolvedValue(null),
      cancelSession: vi.fn(),
      listSessions: vi.fn().mockResolvedValue([]),
      getSession: vi.fn(),
      importSampleCandidates: vi.fn(),
      startSession: vi.fn(),
      importCandidatesCsv: vi.fn(),
      updateCandidateStatus: vi.fn(),
    };

    function Harness() {
      const workspace = useScannerWorkspace(remote, {
        minimumScore: 65,
        watchedTickers: new Set(),
      });
      return createElement(ScannerWorkspace, {
        workspace,
        loading: false,
        watchedTickers: new Set<string>(),
        maxSpreadPct: 1.5,
        onRun: vi.fn(),
        onSelect: vi.fn(),
        onToggleWatch: vi.fn(),
        onIgnore: vi.fn(),
        candidateResearch: createElement("div", null, "Candidate research actions"),
      });
    }

    render(createElement(Harness));
    await user.click(screen.getByRole("button", { name: "Legacy Imports" }));

    expect(await screen.findByRole("heading", { name: "Legacy Imports" })).toBeInTheDocument();
    expect(screen.getByText("Reference only · Not actionable")).toBeInTheDocument();
    expect(screen.getByText("KEEP")).toBeInTheDocument();
    expect(screen.getAllByText("Unknown")).toHaveLength(4);
    expect(screen.queryByText("Candidate research actions")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /KEEP.*watchlist/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ignore KEEP" })).not.toBeInTheDocument();
    expect(remote.listLegacyImports).toHaveBeenCalledTimes(1);
    expect(remote.listLegacyImports).toHaveBeenCalledWith("operational");

    await user.click(screen.getByRole("button", { name: "Demo imports" }));
    await waitFor(() => expect(remote.listLegacyImports).toHaveBeenCalledWith("demo"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("shows Discovery Hit admission outcomes and deduplicated Candidates", () => {
    const candidate = buildCandidate();
    const security = {
      id: 10,
      identifier_source: "test_registry",
      identifier: "security-alfa",
      issuer_name: "Alpha Research Corp",
    };
    const listing = {
      id: 20,
      security_id: 10,
      ticker: "ALFA",
      exchange: "nasdaq",
      status: "active",
      instrument_type: "common_stock",
      effective_from: "2020-01-01",
      effective_to: null,
      foreign_issuer: false,
      depositary_to_underlying_ratio: null,
    };
    const scannerSession = buildSession({
      status: "completed",
      stage: "completed",
      discovery_hits: [
        {
          id: 30,
          source: "csv",
          source_reference: "supplementary.csv:2",
          observed_at: "2026-08-09T08:00:00Z",
          ticker: "ALFA",
          discovery_reason: "CSV activity screen",
          observed_listing: {
            ticker: "ALFA",
            exchange: "nasdaq",
            status: "active",
            instrument_type: "common_stock",
            effective_from: "2020-01-01",
            effective_to: null,
            foreign_issuer: false,
            depositary_to_underlying_ratio: null,
          },
          admission_outcome: "admitted",
          admission_reasons: ["target_instrument_universe"],
          security,
          listing,
          candidate_id: 40,
        },
        {
          id: 31,
          source: "manual",
          source_reference: "operator:desk",
          observed_at: "2026-08-09T08:00:00Z",
          ticker: "MYST",
          discovery_reason: "Needs identity review",
          observed_listing: {
            ticker: "MYST",
            exchange: null,
            status: null,
            instrument_type: null,
            effective_from: null,
            effective_to: null,
            foreign_issuer: null,
            depositary_to_underlying_ratio: null,
          },
          admission_outcome: "unresolved",
          admission_reasons: ["security_identity_unresolved"],
          security: null,
          listing: null,
          candidate_id: null,
        },
      ],
      candidates: [
        {
          id: 40,
          security,
          observed_listings: [
            listing,
            { ...listing, effective_to: "2026-08-10" },
            { ...listing, id: 21, ticker: "ALFB" },
          ],
          discovery_hit_ids: [30],
          discovery_sources: ["csv"],
          discovery_reasons: ["CSV activity screen"],
        },
      ],
    });

    render(
      createElement(ScannerWorkspace, {
        workspace: { ...buildWorkspace(candidate), displayedSession: scannerSession },
        loading: false,
        watchedTickers: new Set<string>(),
        maxSpreadPct: 1.5,
        onRun: vi.fn(),
        onSelect: vi.fn(),
        onToggleWatch: vi.fn(),
        onIgnore: vi.fn(),
        candidateResearch: null,
      }),
    );

    expect(screen.getByRole("region", { name: "Discovery Hits" })).toHaveTextContent("ALFA");
    expect(screen.getByRole("region", { name: "Discovery Hits" })).toHaveTextContent("unresolved");
    expect(screen.getByRole("region", { name: "Admitted Candidates" })).toHaveTextContent("Alpha Research Corp");
    expect(within(screen.getByRole("region", { name: "Admitted Candidates" })).getByText("ALFA, ALFB", { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/supplementary\.csv:2/)).toBeInTheDocument();
  });

  test("labels delayed consolidated discovery and a successful zero-Candidate result", () => {
    render(createElement(ScannerWorkspace, {
      workspace: {
        ...buildWorkspace(buildCandidate()),
        displayedSession: buildSession({
          status: "completed", stage: "completed",
          diagnostics: [{
            source: "alpaca_delayed_bars", capability: "market_movement", required: true,
            status: "completed", records_count: 0, code: null, message: "Discovery completed",
            started_at: null, completed_at: null,
            details: {
              data_tier: "delayed_consolidated", coverage: "consolidated_us_equities",
              expected_delay_seconds: 900, eligible_listings: 100,
              requested_symbols: 100, symbols_with_bars: 98,
              observed_at: "2026-07-06T13:45:00Z", provider_event_at: "2026-07-06T13:29:00Z",
            },
          }],
        }),
      },
      loading: false, watchedTickers: new Set<string>(), maxSpreadPct: 1.5,
      onRun: vi.fn(), onSelect: vi.fn(), onToggleWatch: vi.fn(), onIgnore: vi.fn(),
      candidateResearch: null,
    }));
    const contract = screen.getByLabelText("Market-Movement Discovery source contract");
    expect(contract).toHaveTextContent("Delayed consolidated bars · Not real-time");
    expect(contract).toHaveTextContent("Expected delay: 15 minutes");
    expect(contract).toHaveTextContent("Symbols with bars: 98 / 100");
    expect(contract).toHaveTextContent("Latest provider event: 2026-07-06T13:29:00Z");
    expect(screen.getByText("Discovery completed with no hits · 0 Candidates.")).toBeInTheDocument();
  });

  test("offers watch and ignore actions on mobile with desktop-equivalent saving guards", () => {
    const candidate = buildCandidate();
    const props = {
      workspace: buildWorkspace(candidate, "ALFA-candidate"),
      loading: false,
      watchedTickers: new Set<string>(),
      maxSpreadPct: 1.5,
      onRun: vi.fn(),
      onSelect: vi.fn(),
      onToggleWatch: vi.fn(),
      onIgnore: vi.fn(),
      candidateResearch: null,
    };
    const { container, rerender } = render(createElement(ScannerWorkspace, props));
    const mobileResults = container.querySelector(".md\\:hidden");
    expect(mobileResults).not.toBeNull();
    const mobile = within(mobileResults as HTMLElement);

    expect(mobile.getByRole("button", { name: "Add ALFA to watchlist" })).toBeDisabled();

    rerender(createElement(ScannerWorkspace, { ...props, workspace: buildWorkspace(candidate, "ALFA-ignore") }));
    expect(mobile.getByRole("button", { name: "Ignore ALFA" })).toBeDisabled();
  });

  test("loads paginated session summaries before fetching only the displayed session details", async () => {
    const detailedSession = buildSession({ id: 7, status: "completed", stage: "completed" });
    const remote: ScannerRemote = {
      listCandidates: vi.fn().mockResolvedValue([]),
      listLegacyImports: vi.fn().mockResolvedValue([]),
      getCurrentSession: vi.fn().mockResolvedValue(null),
      cancelSession: vi.fn(),
      listSessions: vi.fn().mockResolvedValue([
        buildSessionSummary({ id: 7, status: "completed", stage: "completed" }),
      ]),
      getSession: vi.fn().mockResolvedValue(detailedSession),
      importSampleCandidates: vi.fn(),
      startSession: vi.fn(),
      importCandidatesCsv: vi.fn(),
      updateCandidateStatus: vi.fn(),
    };
    const { result } = renderHook(() =>
      useScannerWorkspace(remote, { minimumScore: 65, watchedTickers: new Set() }),
    );

    await act(async () => {
      await result.current.load();
    });

    expect(remote.getSession).toHaveBeenCalledWith(7);
    expect(result.current.sessions).toEqual([detailedSession]);
  });

  test("keeps concurrent scanner actions pending independently", async () => {
    const sampleImport = deferred<ScannerSymbol[]>();
    const csvImport = deferred<ScannerSession>();
    const remote: ScannerRemote = {
      listCandidates: vi.fn().mockResolvedValue([]),
      listLegacyImports: vi.fn().mockResolvedValue([]),
      getCurrentSession: vi.fn().mockResolvedValue(null),
      cancelSession: vi.fn(),
      listSessions: vi.fn().mockResolvedValue([]),
      getSession: vi.fn(),
      importSampleCandidates: vi.fn(() => sampleImport.promise),
      startSession: vi.fn(),
      importCandidatesCsv: vi.fn(() => csvImport.promise),
      updateCandidateStatus: vi.fn(),
    };
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useScannerWorkspace(remote, { minimumScore: 65, watchedTickers: new Set() }),
    );
    let samplePromise!: Promise<string>;
    let csvPromise!: Promise<string>;

    act(() => {
      samplePromise = result.current.importSample(refresh);
      csvPromise = result.current.importCsv(new File(["ticker"], "candidates.csv"), refresh);
    });
    expect(result.current.pendingActions).toEqual(new Set(["import", "csv-import"]));

    sampleImport.resolve([]);
    await act(async () => {
      await samplePromise;
    });
    expect(result.current.pendingActions).toEqual(new Set(["csv-import"]));

    csvImport.resolve(buildSession({ id: 2, status: "completed", stage: "completed" }));
    await act(async () => {
      await csvPromise;
    });
    expect(result.current.pendingActions).toEqual(new Set());
  });

  test("does not overlap Scanner Session refresh requests", async () => {
    vi.useFakeTimers();
    const pendingRefresh = deferred<ScannerSession>();
    const session = buildSession();
    const remote: ScannerRemote = {
      listCandidates: vi.fn().mockResolvedValue([]),
      listLegacyImports: vi.fn().mockResolvedValue([]),
      getCurrentSession: vi.fn().mockResolvedValue(null),
      cancelSession: vi.fn(),
      listSessions: vi.fn().mockResolvedValue([]),
      getSession: vi
        .fn()
        .mockImplementationOnce(() => pendingRefresh.promise)
        .mockResolvedValue(buildSession({ progress: { completed: 2, total: 4, percent: 50 } })),
      importSampleCandidates: vi.fn().mockResolvedValue([]),
      startSession: vi.fn().mockResolvedValue(session),
      importCandidatesCsv: vi.fn().mockResolvedValue(buildSession({ id: 2 })),
      updateCandidateStatus: vi.fn(),
    };
    const { result } = renderHook(() =>
      useScannerWorkspace(remote, { minimumScore: 65, watchedTickers: new Set() }),
    );

    await act(async () => {
      await result.current.startSession();
    });
    expect(remote.getSession).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(remote.getSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingRefresh.resolve(buildSession({ progress: { completed: 1, total: 4, percent: 25 } }));
      await pendingRefresh.promise;
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(remote.getSession).toHaveBeenCalledTimes(2);
  });
});

 test("history inspection and cancellation preserve the actionable current view", async () => {
  const good = buildSession({ id: 20, status: "completed", stage: "completed" });
  const active = buildSession({ id: 21 });
  const cancelled = buildSession({ ...active, status: "cancelled", stage: "cancelled" });
  const historical = buildSession({ id: 19, status: "partial", stage: "partial" });
  const remote: ScannerRemote = {
    listCandidates: vi.fn().mockResolvedValue([]),
    listLegacyImports: vi.fn().mockResolvedValue([]),
    getCurrentSession: vi.fn().mockResolvedValue(good),
    listSessions: vi.fn().mockResolvedValue([buildSessionSummary({ id: 21 }), buildSessionSummary({ id: 19, status: "partial" })]),
    getSession: vi.fn((id: number) => Promise.resolve(id === 19 ? historical : active)),
    cancelSession: vi.fn().mockResolvedValue(cancelled),
    importSampleCandidates: vi.fn(), startSession: vi.fn(), importCandidatesCsv: vi.fn(), updateCandidateStatus: vi.fn(),
  };
  const { result } = renderHook(() => useScannerWorkspace(remote, { minimumScore: 65, watchedTickers: new Set() }));
  await act(async () => { await result.current.load(); });
  await act(async () => { await result.current.inspectSession(19); });
  expect(result.current.displayedSession).toEqual(historical);
  expect(result.current.currentSession).toEqual(good);
  expect(result.current.activeSessionId).toBe(21);
  await act(async () => { await result.current.cancelSession(); });
  expect(remote.cancelSession).toHaveBeenCalledWith(21);
  expect(result.current.displayedSession).toEqual(historical);
  expect(result.current.currentSession).toEqual(good);
  expect(result.current.activeSessionId).toBeNull();
  await act(async () => { await result.current.inspectSession(null); });
  expect(result.current.displayedSession).toEqual(cancelled);
});

test("shows no-current state and labels historical inspection separately", () => {
  const workspace = buildWorkspace(buildCandidate());
  workspace.inspectedSession = buildSession({ status: "partial", stage: "partial" });
  workspace.displayedSession = workspace.inspectedSession;
  render(createElement(ScannerWorkspace, {
    workspace, loading: false, watchedTickers: new Set<string>(), maxSpreadPct: 1.5,
    onRun: vi.fn(), onSelect: vi.fn(), onToggleWatch: vi.fn(), onIgnore: vi.fn(), candidateResearch: null,
  }));
  expect(screen.getByText("No Actionable Current Session")).toBeInTheDocument();
  expect(screen.getByText(/Historical inspection only/)).toBeInTheDocument();
  expect(screen.getByLabelText("Inspect attempt")).toBeInTheDocument();
});
