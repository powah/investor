import { useCallback, useState } from "react";
import { BarChart3, ClipboardList } from "lucide-react";
import { currency, number } from "@/lib/api";
import { EquityChart } from "@/modules/trading-dashboard/analytics/equity-chart";
import type { Analytics, JournalEntry } from "@/types/trading";

export type AnalyticsRemote = {
  getSummary(): Promise<Analytics>;
};

const emptyAnalytics: Analytics = {
  total_trades: 0,
  win_rate: 0,
  average_win: 0,
  average_loss: 0,
  net_pnl: 0,
  average_r: 0,
  best_catalyst_type: null,
  most_common_mistake: null,
};

export function useAnalyticsWorkspace(remote: AnalyticsRemote) {
  const [summary, setSummary] = useState<Analytics>(emptyAnalytics);

  const load = useCallback(async () => {
    const value = await remote.getSummary();
    setSummary(value);
    return value;
  }, [remote]);

  return { summary, load };
}

export type AnalyticsWorkspaceController = ReturnType<typeof useAnalyticsWorkspace>;

export function AnalyticsWorkspace({
  analytics,
  entries,
}: {
  analytics: AnalyticsWorkspaceController;
  entries: JournalEntry[];
}) {
  const summary = analytics.summary;
  return (
    <div className="space-y-4">
      <PageHeading
        eyebrow="Feedback loop"
        title="Performance analytics"
        description="Use outcomes and process mistakes to improve the playbook—not to turn a small sample into a prediction."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Completed trades" value={summary.total_trades.toString()} />
        <Metric label="Win rate" value={`${number(summary.win_rate, 1)}%`} />
        <Metric label="Average R" value={`${number(summary.average_r, 2)}R`} tone={summary.average_r >= 0 ? "good" : "bad"} />
        <Metric
          label="Plan adherence"
          value={
            entries.length
              ? `${number((entries.filter((entry) => entry.followed_plan).length / entries.length) * 100, 0)}%`
              : "—"
          }
        />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <AnalyticsSummaryPanel analytics={summary} journal={entries} />
        <ProcessReviewPanel analytics={summary} journal={entries} />
      </div>
    </div>
  );
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">{eyebrow}</div>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{title}</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
      </div>
    </div>
  );
}

function ProcessReviewPanel({ analytics, journal }: { analytics: Analytics; journal: JournalEntry[] }) {
  const unplanned = journal.filter((entry) => !entry.followed_plan).length;
  return (
    <section className="panel rounded-xl">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <ClipboardList className="h-4 w-4 text-blue-700" aria-hidden="true" />
        <h3 className="font-semibold text-ink">Process review</h3>
      </div>
      <div className="divide-y divide-line">
        <ReviewRow label="Best catalyst so far" value={analytics.best_catalyst_type ?? "Not enough data"} />
        <ReviewRow label="Most common mistake" value={analytics.most_common_mistake ?? "None recorded"} />
        <ReviewRow label="Trades outside plan" value={unplanned.toString()} tone={unplanned > 0 ? "bad" : "neutral"} />
        <ReviewRow label="Average win / loss" value={`${currency(analytics.average_win)} / ${currency(analytics.average_loss)}`} />
      </div>
      <p className="border-t border-line bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
        Treat small samples as feedback, not prediction. Improve the checklist before changing the scoring model.
      </p>
    </section>
  );
}

function ReviewRow({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "bad" }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`text-right font-semibold ${tone === "bad" ? "text-red-700" : "text-ink"}`}>{value}</span>
    </div>
  );
}


function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "bad" }) {
  const toneClass = tone === "good" ? "text-teal-700" : tone === "bad" ? "text-red-700" : "text-ink";
  return (
    <div className="panel rounded-xl px-4 py-3">
      <div className="label">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}


export function AnalyticsSummaryPanel({ analytics, journal }: { analytics: Analytics; journal: JournalEntry[] }) {
  return (
    <section className="panel overflow-hidden rounded-xl">
      <div className="flex items-center gap-2 px-4 py-3">
        <BarChart3 className="h-4 w-4 text-blue-700" />
        <h2 className="text-base font-semibold text-ink">Analytics</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-line px-4 py-4 text-sm">
        <Stat label="Trades" value={analytics.total_trades.toString()} />
        <Stat label="Avg R" value={`${number(analytics.average_r, 2)}R`} />
        <Stat label="Avg win" value={currency(analytics.average_win)} />
        <Stat label="Avg loss" value={currency(analytics.average_loss)} />
        <Stat label="Best catalyst" value={analytics.best_catalyst_type ?? "-"} />
        <Stat label="Top mistake" value={analytics.most_common_mistake ?? "-"} />
      </div>
      <EquityChart entries={journal} />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mt-1 break-words font-semibold text-ink">{value}</div>
    </div>
  );
}
