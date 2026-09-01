import { afterEach, describe, expect, test, vi } from "vitest";
import { httpTradingDashboard } from "@/modules/trading-dashboard/http-trading-dashboard";
import { buildCandidate } from "@/test/fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HTTP trading dashboard", () => {
  test("encodes ticker path segments for scanner and watchlist operations", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(buildCandidate({ ticker: "ALFA/B?#" })),
      })
      .mockResolvedValueOnce({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetch);

    await httpTradingDashboard.scanner.updateCandidateStatus("ALFA/B?#", "watch");
    await httpTradingDashboard.watchlist.removeItem("ALFA/B?#");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/api/scanner/ALFA%2FB%3F%23/status",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/watchlist/ALFA%2FB%3F%23",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
