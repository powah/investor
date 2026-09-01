import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  CandidateResearchPanel,
  useCandidateResearch,
  type CandidateResearchRemote,
} from "@/modules/trading-dashboard/candidate-research/candidate-research";

function datetimeLocal(date: Date) {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 16);
}

describe("candidate research", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("requires persisted catalyst review values", () => {
    const remote: CandidateResearchRemote = {
      listCatalysts: vi.fn().mockResolvedValue([]),
      createCatalystReview: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = renderHook(() => useCandidateResearch(remote, "ALFA"));

    render(
      <CandidateResearchPanel
        research={result.current}
        symbol={null}
        isWatched={false}
        pendingActions={new Set()}
        onToggleWatch={vi.fn()}
        onPlan={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Published")).toBeRequired();
    expect(screen.getByLabelText(/Quality score/)).toBeRequired();
  });

  test("starts the next catalyst review with a fresh publication time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T08:00:00Z"));
    const remote: CandidateResearchRemote = {
      listCatalysts: vi.fn().mockResolvedValue([]),
      createCatalystReview: vi.fn().mockResolvedValue(undefined),
    };
    const { result } = renderHook(() => useCandidateResearch(remote, "ALFA"));

    act(() => {
      result.current.setDraft((current) => ({
        ...current,
        headline: "Reviewed catalyst",
        published_time: "2026-08-01T09:30",
      }));
    });

    const refreshedAt = new Date("2026-08-09T08:05:00Z");
    await act(async () => {
      await result.current.saveReview(async () => {
        vi.setSystemTime(refreshedAt);
      });
    });

    expect(result.current.draft.headline).toBe("");
    expect(result.current.draft.published_time).toBe(datetimeLocal(refreshedAt));
  });
});
