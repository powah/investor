import { describe, expect, test } from "vitest";
import { filterScannerCandidates } from "@/modules/trading-dashboard/scanner/scanner-workspace";
import { buildCandidate } from "@/test/fixtures";

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
