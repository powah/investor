import { act, render, renderHook, within } from "@testing-library/react";
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
import type { ScannerSession, ScannerSymbol } from "@/types/trading";

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
    ...overrides,
  };
}

function buildWorkspace(candidate: ScannerSymbol, action: string | null = null): ScannerWorkspaceController {
  return {
    candidates: [candidate],
    sessions: [],
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
  afterEach(() => {
    vi.useRealTimers();
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

  test("keeps concurrent scanner actions pending independently", async () => {
    const sampleImport = deferred<ScannerSymbol[]>();
    const csvImport = deferred<ScannerSymbol[]>();
    const remote: ScannerRemote = {
      listCandidates: vi.fn().mockResolvedValue([]),
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

    csvImport.resolve([]);
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
      listSessions: vi.fn().mockResolvedValue([]),
      getSession: vi
        .fn()
        .mockImplementationOnce(() => pendingRefresh.promise)
        .mockResolvedValue(buildSession({ progress: { completed: 2, total: 4, percent: 50 } })),
      importSampleCandidates: vi.fn().mockResolvedValue([]),
      startSession: vi.fn().mockResolvedValue(session),
      importCandidatesCsv: vi.fn().mockResolvedValue([]),
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
