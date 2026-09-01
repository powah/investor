import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import {
  useJournalWorkspace,
  type JournalDraft,
  type JournalRemote,
} from "@/modules/trading-dashboard/journal/journal-workspace";
import type { JournalEntry } from "@/types/trading";

const savedEntry: JournalEntry = {
  id: 1,
  trade_date: "2026-09-01",
  ticker: "ALFA",
  setup: "Catalyst momentum",
  catalyst_type: "Contract",
  entry_price: 10,
  stop_price: 9.5,
  exit_price: 11,
  shares: 100,
  pnl: 100,
  r_multiple: 2,
  notes: "Held the plan.",
  mistake_tags: [],
  followed_plan: true,
  created_at: "2026-09-01T12:00:00Z",
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function completedDraft(current: JournalDraft): JournalDraft {
  return {
    ...current,
    ticker: "ALFA",
    catalyst_type: "Contract",
    entry_price: "10",
    stop_price: "9.5",
    exit_price: "11",
    shares: "100",
    pnl: "100",
    notes: "Held the plan.",
    mistake_tags: "",
  };
}

describe("Journal workspace", () => {
  test("forwards the draft, awaits refresh, exposes saving, and resets execution fields", async () => {
    const refreshFinished = deferred();
    const remote: JournalRemote = {
      listEntries: vi.fn().mockResolvedValue([]),
      createEntry: vi.fn().mockResolvedValue(savedEntry),
    };
    const refresh = vi.fn(() => refreshFinished.promise);
    const { result } = renderHook(() => useJournalWorkspace(remote));

    act(() => result.current.setDraft(completedDraft));
    const submittedDraft = result.current.draft;
    let savePromise!: Promise<string>;

    await act(async () => {
      savePromise = result.current.save(refresh);
      await Promise.resolve();
    });

    expect(remote.createEntry).toHaveBeenCalledWith(submittedDraft);
    expect(refresh).toHaveBeenCalledOnce();
    expect(result.current.saving).toBe(true);

    refreshFinished.resolve();
    await act(async () => {
      await expect(savePromise).resolves.toBe("Journal entry saved.");
    });

    expect(result.current.saving).toBe(false);
    expect(result.current.draft).toEqual({
      ...submittedDraft,
      exit_price: "",
      shares: "",
      pnl: "",
      notes: "",
      mistake_tags: "",
    });
  });

  test("keeps the draft and clears saving when persistence fails", async () => {
    const remote: JournalRemote = {
      listEntries: vi.fn().mockResolvedValue([]),
      createEntry: vi.fn().mockRejectedValue(new Error("save failed")),
    };
    const refresh = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useJournalWorkspace(remote));

    act(() => result.current.setDraft(completedDraft));
    const submittedDraft = result.current.draft;

    await act(async () => {
      await expect(result.current.save(refresh)).rejects.toThrow("save failed");
    });

    expect(refresh).not.toHaveBeenCalled();
    expect(result.current.saving).toBe(false);
    expect(result.current.draft).toEqual(submittedDraft);
  });
});
