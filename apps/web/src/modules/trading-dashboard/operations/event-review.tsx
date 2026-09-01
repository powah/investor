import { useCallback, useState } from "react";
import { ArrowRight, CheckCircle2, ExternalLink, Newspaper } from "lucide-react";
import { apiMessage, Field, formatOperationTime } from "@/modules/trading-dashboard/operations/shared";
import type { ExternalNewsEvent } from "@/types/trading";

export type PromotionDraft = {
  catalyst_type: string;
  quality_score: string;
};

export type EventReviewRemote = {
  listExternalEvents(): Promise<ExternalNewsEvent[]>;
  promoteExternalEvent(eventId: number, draft: PromotionDraft): Promise<ExternalNewsEvent>;
};

export function useEventReviewCapability(remote: EventReviewRemote) {
  const [events, setEvents] = useState<ExternalNewsEvent[]>([]);
  const [drafts, setDrafts] = useState<Record<number, PromotionDraft>>({});

  const load = useCallback(async () => {
    try {
      const values = await remote.listExternalEvents();
      setEvents(values);
      setDrafts((current) => {
        const next = { ...current };
        values.forEach((event) => {
          if (!next[event.id]) {
            next[event.id] = {
              catalyst_type: event.category || "Other",
              quality_score: "10",
            };
          }
        });
        return next;
      });
      return [] as string[];
    } catch (error) {
      return [`external events: ${apiMessage(error)}`];
    }
  }, [remote]);

  const promote = useCallback(
    async (
      event: ExternalNewsEvent,
      refresh: () => Promise<void>,
      refreshWorkspace: () => Promise<void>,
    ) => {
      const draft = drafts[event.id] ?? {
        catalyst_type: event.category || "Other",
        quality_score: "10",
      };
      await remote.promoteExternalEvent(event.id, draft);
      await Promise.all([refresh(), refreshWorkspace()]);
      return `${event.ticker} was promoted only after your catalyst review.`;
    },
    [drafts, remote],
  );

  return { events, drafts, setDrafts, load, promote };
}

function toNumber(value: string) {
  return Number(value);
}

export function EventReviewCapability({
  events,
  drafts,
  setDrafts,
  action,
  onPromote,
}: {
  events: ExternalNewsEvent[];
  drafts: Record<number, PromotionDraft>;
  setDrafts: React.Dispatch<React.SetStateAction<Record<number, PromotionDraft>>>;
  action: string | null;
  onPromote: (event: ExternalNewsEvent) => Promise<void>;
}) {
  function patch(event: ExternalNewsEvent, update: Partial<PromotionDraft>) {
    setDrafts((current) => ({
      ...current,
      [event.id]: {
        catalyst_type: current[event.id]?.catalyst_type ?? event.category ?? "Other",
        quality_score: current[event.id]?.quality_score ?? "10",
        ...update,
      },
    }));
  }

  return (
    <section className="panel overflow-hidden rounded-xl" aria-labelledby="external-events-heading">
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Newspaper className="h-4 w-4 text-blue-700" aria-hidden="true" />
            <h3 id="external-events-heading" className="font-semibold text-ink">External event inbox</h3>
          </div>
          <p className="mt-1 text-sm text-slate-500">Review source, category, and quality. Promotion is always explicit.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{events.length} stored</span>
      </div>
      {events.length ? (
        <div className="grid max-h-[760px] gap-3 overflow-y-auto p-3 lg:grid-cols-2">
          {events.map((event) => {
            const draft = drafts[event.id] ?? { catalyst_type: event.category || "Other", quality_score: "10" };
            const promoted = event.promoted_catalyst_id != null;
            return (
              <article key={event.id} className="rounded-xl border border-line bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-slate-950 px-2 py-1 font-semibold text-white">{event.ticker}</span>
                    <span>{event.source}</span>
                    <span className="capitalize">{event.provider.replaceAll("_", " ")}</span>
                  </div>
                  <time dateTime={event.published_at}>{formatOperationTime(event.published_at)}</time>
                </div>
                <h4 className="mt-3 font-semibold leading-6 text-ink">{event.headline}</h4>
                {event.summary && <p className="mt-1 line-clamp-3 text-sm leading-6 text-slate-600">{event.summary}</p>}
                {event.url && (
                  <a
                    className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:text-blue-900"
                    href={event.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Review source <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                )}

                {promoted ? (
                  <div className="mt-4 flex items-center gap-2 rounded-lg bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-800">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Promoted to reviewed catalyst
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-blue-800">Human review required</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
                      <Field label="Catalyst type">
                        <input
                          className="field"
                          value={draft.catalyst_type}
                          onChange={(inputEvent) => patch(event, { catalyst_type: inputEvent.target.value })}
                        />
                      </Field>
                      <Field label="Quality / 20">
                        <input
                          className="field"
                          type="number"
                          min="0"
                          max="20"
                          step="1"
                          value={draft.quality_score}
                          onChange={(inputEvent) => patch(event, { quality_score: inputEvent.target.value })}
                        />
                      </Field>
                    </div>
                    <button
                      className="primary-button mt-3 w-full"
                      type="button"
                      disabled={
                        action === `promote-${event.id}` ||
                        !draft.catalyst_type.trim() ||
                        toNumber(draft.quality_score) < 0 ||
                        toNumber(draft.quality_score) > 20
                      }
                      onClick={() => void onPromote(event)}
                    >
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      {action === `promote-${event.id}` ? "Promoting" : "Promote after review"}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="px-4 py-12 text-center">
          <Newspaper className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
          <h4 className="mt-3 font-semibold text-ink">No external events yet</h4>
          <p className="mt-1 text-sm text-slate-500">Sync news and SEC filings, then review the inbox here.</p>
        </div>
      )}
    </section>
  );
}
