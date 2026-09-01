import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  useWatchlistWorkspace,
  type WatchlistRemote,
} from "@/modules/trading-dashboard/watchlist/watchlist-workspace";
import { buildCandidate } from "@/test/fixtures";
import type { WatchlistItem } from "@/types/trading";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const item: WatchlistItem = {
  id: 1,
  ticker: "ALFA",
  notes: "Wait for support.",
  created_at: "2026-09-01T12:00:00Z",
  symbol: buildCandidate(),
};

describe("Watchlist workspace", () => {
  test("keeps remove and note-save actions pending independently", async () => {
    const removal = deferred<void>();
    const noteSave = deferred<WatchlistItem>();
    const remote: WatchlistRemote = {
      listItems: vi.fn().mockResolvedValue([item]),
      removeItem: vi.fn(() => removal.promise),
      saveNotes: vi.fn(() => noteSave.promise),
    };
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useWatchlistWorkspace(remote));
    let removePromise!: Promise<string>;
    let savePromise!: Promise<string>;

    act(() => {
      removePromise = result.current.remove("ALFA", refresh);
      savePromise = result.current.saveNote("ALFA", refresh);
    });
    expect(result.current.pendingActions).toEqual(new Set(["remove-ALFA", "note-ALFA"]));

    removal.resolve(undefined);
    await act(async () => {
      await removePromise;
    });
    expect(result.current.pendingActions).toEqual(new Set(["note-ALFA"]));

    noteSave.resolve(item);
    await act(async () => {
      await savePromise;
    });
    expect(result.current.pendingActions).toEqual(new Set());
  });
});
