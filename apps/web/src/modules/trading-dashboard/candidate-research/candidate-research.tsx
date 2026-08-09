import { useCallback, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Eye, Plus, Save, ShieldCheck } from "lucide-react";
import { currency, number } from "@/lib/api";
import type { CatalystDraft } from "@/modules/trading-dashboard/contracts";
import type { Catalyst, ScannerSymbol } from "@/types/trading";

export type CandidateResearchRemote = {
  listCatalysts(): Promise<Catalyst[]>;
  createCatalystReview(draft: CatalystDraft): Promise<void>;
};

function datetimeLocalNow() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

export function useCandidateResearch(remote: CandidateResearchRemote, selectedTicker: string) {
  const [catalysts, setCatalysts] = useState<Catalyst[]>([]);
  const [draft, setDraft] = useState<CatalystDraft>({
    ticker: "",
    published_time: datetimeLocalNow(),
    source: "Manual",
    headline: "",
    catalyst_type: "FDA",
    quality_score: "20",
  });

  const load = useCallback(async () => {
    const values = await remote.listCatalysts();
    setCatalysts(values);
    return values;
  }, [remote]);

  const selectedCatalysts = useMemo(
    () => catalysts.filter((catalyst) => catalyst.ticker === selectedTicker).slice(0, 4),
    [catalysts, selectedTicker],
  );

  const selectCandidate = useCallback((candidate: ScannerSymbol) => {
    setDraft((current) => ({
      ...current,
      ticker: candidate.ticker,
      catalyst_type: candidate.catalyst_type || current.catalyst_type,
      headline: candidate.news_headline || current.headline,
    }));
  }, []);

  const saveReview = useCallback(
    async (refresh: () => Promise<void>) => {
      await remote.createCatalystReview(draft);
      await refresh();
      setDraft((current) => ({ ...current, published_time: datetimeLocalNow(), headline: "" }));
      return "Catalyst saved.";
    },
    [draft, remote],
  );

  return { catalysts, selectedCatalysts, draft, setDraft, load, selectCandidate, saveReview };
}

export type CandidateResearchController = ReturnType<typeof useCandidateResearch>;

export function CandidateResearchPanel({
  research,
  symbol,
  isWatched,
  saving,
  onToggleWatch,
  onPlan,
  onSubmit,
}: {
  research: CandidateResearchController;
  symbol: ScannerSymbol | null;
  isWatched: boolean;
  saving: string | null;
  onToggleWatch: (symbol: ScannerSymbol) => Promise<void>;
  onPlan: (symbol: ScannerSymbol) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <aside className="space-y-4 xl:sticky xl:top-[158px] xl:self-start">
      <CandidateDetailPanel
        symbol={symbol}
        catalysts={research.selectedCatalysts}
        isWatched={isWatched}
        saving={saving}
        onToggleWatch={onToggleWatch}
        onPlan={onPlan}
      />
      <CatalystPanel
        draft={research.draft}
        setDraft={research.setDraft}
        onSubmit={onSubmit}
        saving={saving === "catalyst"}
      />
    </aside>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      {children}
    </label>
  );
}

export function CandidateDetailPanel({
  symbol,
  catalysts,
  isWatched,
  saving,
  onToggleWatch,
  onPlan,
  compact = false,
}: {
  symbol: ScannerSymbol | null;
  catalysts: Catalyst[];
  isWatched: boolean;
  saving: string | null;
  onToggleWatch: (symbol: ScannerSymbol) => Promise<void>;
  onPlan: (symbol: ScannerSymbol) => void;
  compact?: boolean;
}) {
  if (!symbol) {
    return (
      <section className="panel rounded-xl p-6 text-center">
        <ClipboardList className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
        <h3 className="mt-3 font-semibold text-ink">Select a scanner name</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500">Its score evidence, catalyst, and risk flags will appear here.</p>
      </section>
    );
  }

  const catalystFreshnessLabel = symbol.latest_catalyst_published_time
    ? symbol.latest_catalyst_is_fresh
      ? "Fresh · within 72h"
      : "Stale · over 72h"
    : "No dated catalyst";

  return (
    <section className="panel overflow-hidden rounded-xl">
      <div className="border-b border-line bg-slate-950 px-4 py-4 text-white">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-2xl font-semibold">{symbol.ticker}</h3>
              <span className="rounded-full bg-white/10 px-2 py-1 text-xs font-semibold text-slate-200">{symbol.label}</span>
            </div>
            <div className="mt-1 text-sm text-slate-300">{currency(symbol.price)} · {number(symbol.market_cap_m, 1)}M market cap</div>
          </div>
          <div className="rounded-xl bg-white px-3 py-2 text-center text-slate-950">
            <div className="text-2xl font-semibold leading-none">{symbol.score}</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Score</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-white/10 px-2 py-2"><span className="block font-semibold">{number(symbol.gap_pct, 1)}%</span><span className="text-slate-300">Gap</span></div>
          <div className="rounded-lg bg-white/10 px-2 py-2"><span className="block font-semibold">{number(symbol.rel_volume, 1)}×</span><span className="text-slate-300">RVOL</span></div>
          <div className="rounded-lg bg-white/10 px-2 py-2"><span className="block font-semibold">{number(symbol.spread_pct, 1)}%</span><span className="text-slate-300">Spread</span></div>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <div className="label">Why it is moving</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="font-semibold text-ink">{symbol.catalyst_type || "No catalyst category"}</span>
            <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${symbol.latest_catalyst_is_fresh ? "bg-teal-50 text-teal-700" : "bg-amber-50 text-amber-800"}`}>
              {catalystFreshnessLabel}
            </span>
            {symbol.latest_catalyst_quality_score != null && (
              <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                Quality {symbol.latest_catalyst_quality_score}/20
              </span>
            )}
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">{symbol.news_headline || "No fresh catalyst has been recorded."}</p>
        </div>

        <div>
          <div className="label">Score evidence</div>
          <ul className="mt-2 space-y-2">
            {symbol.reasons.map((reason) => (
              <li key={reason} className="flex gap-2 text-sm text-slate-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
                <span>{reason}</span>
              </li>
            ))}
            {symbol.reasons.length === 0 && <li className="text-sm text-slate-500">No positive scoring factors recorded.</li>}
          </ul>
        </div>

        <div>
          <div className="label">Risk review</div>
          <ul className="mt-2 space-y-2">
            {symbol.risk_warnings.map((warning) => (
              <li key={warning} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{warning}</span>
              </li>
            ))}
            {symbol.risk_warnings.length === 0 && (
              <li className="flex gap-2 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>No current scanner warnings. A valid plan still requires a defined stop.</span>
              </li>
            )}
          </ul>
        </div>

        {!compact && catalysts.length > 0 && (
          <div>
            <div className="label">Catalyst history</div>
            <div className="mt-2 space-y-2">
              {catalysts.map((catalyst) => (
                <div key={catalyst.id} className="rounded-lg border border-line px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span>{catalyst.source}</span>
                    <span>{new Date(catalyst.published_time).toLocaleDateString()}</span>
                  </div>
                  <div className="mt-1 text-sm font-medium text-ink">{catalyst.headline}</div>
                  <div className="mt-1 text-xs text-slate-500">{catalyst.catalyst_type} · quality {catalyst.quality_score}/20</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            className={isWatched ? "secondary-active-button" : "text-button"}
            type="button"
            aria-pressed={isWatched}
            disabled={saving === `${symbol.ticker}-watch` || saving === `${symbol.ticker}-candidate`}
            onClick={() => void onToggleWatch(symbol)}
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            {isWatched ? "Watching" : "Add to watchlist"}
          </button>
          <button className="primary-button" type="button" onClick={() => onPlan(symbol)}>
            Build plan <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}


function CatalystPanel({
  draft,
  setDraft,
  onSubmit,
  saving,
}: {
  draft: CatalystDraft;
  setDraft: React.Dispatch<React.SetStateAction<CatalystDraft>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  return (
    <section className="panel overflow-hidden rounded-xl">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Plus className="h-4 w-4 text-blue-700" />
        <h2 className="text-base font-semibold text-ink">Catalyst</h2>
      </div>
      <form className="grid gap-3 px-4 py-4" onSubmit={onSubmit}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ticker">
            <input
              className="field uppercase"
              required
              value={draft.ticker}
              onChange={(event) => setDraft((current) => ({ ...current, ticker: event.target.value.toUpperCase() }))}
            />
          </Field>
          <Field label="Published">
            <input
              className="field"
              type="datetime-local"
              required
              value={draft.published_time}
              onChange={(event) => setDraft((current) => ({ ...current, published_time: event.target.value }))}
            />
          </Field>
          <Field label="Source">
            <input
              className="field"
              value={draft.source}
              onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))}
            />
          </Field>
          <Field label="Type">
            <select
              className="field"
              value={draft.catalyst_type}
              onChange={(event) => setDraft((current) => ({ ...current, catalyst_type: event.target.value }))}
            >
              <option>FDA</option>
              <option>Clinical data</option>
              <option>Earnings</option>
              <option>Contract</option>
              <option>Partnership</option>
              <option>Guidance</option>
              <option>Analyst action</option>
              <option>Vague PR</option>
              <option>Offering</option>
              <option>No fresh news</option>
            </select>
          </Field>
        </div>
        <Field label="Headline">
          <textarea
            className="field min-h-20"
            required
            value={draft.headline}
            onChange={(event) => setDraft((current) => ({ ...current, headline: event.target.value }))}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Quality score">
            <input
              className="field"
              type="number"
              min="0"
              max="20"
              step="1"
              required
              value={draft.quality_score}
              onChange={(event) => setDraft((current) => ({ ...current, quality_score: event.target.value }))}
            />
            <span className="mt-1 block text-xs leading-5 text-slate-500">A fresh catalyst contributes this many points, up to 20.</span>
          </Field>
          <div className="flex items-end">
            <button className="primary-button w-full" type="submit" disabled={saving}>
              <Save className="h-4 w-4" />
              Save
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
