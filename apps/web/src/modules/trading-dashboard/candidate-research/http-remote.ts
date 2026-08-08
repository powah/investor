import { apiFetch } from "@/lib/api";
import type { CandidateResearchRemote, CatalystDraft } from "@/modules/trading-dashboard/candidate-research/candidate-research";
import type { Catalyst } from "@/types/trading";

function catalystPayload(draft: CatalystDraft) {
  return {
    ...draft,
    ticker: draft.ticker.toUpperCase(),
    quality_score: Number(draft.quality_score),
  };
}

export const httpCandidateResearchRemote: CandidateResearchRemote = {
  listCatalysts: () => apiFetch<Catalyst[]>("/catalysts"),
  createCatalystReview: (draft) =>
    apiFetch<void>("/catalysts", {
      method: "POST",
      body: JSON.stringify(catalystPayload(draft)),
    }),
};
