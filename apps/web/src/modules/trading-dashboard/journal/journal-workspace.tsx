import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import { BookOpen, Plus, Save } from "lucide-react";
import { currency, number, todayIsoDate } from "@/lib/api";
import type { JournalEntry, ScannerSymbol, TradePlan } from "@/types/trading";

export type JournalDraft = {
  trade_date: string;
  ticker: string;
  setup: string;
  catalyst_type: string;
  entry_price: string;
  stop_price: string;
  exit_price: string;
  shares: string;
  pnl: string;
  notes: string;
  mistake_tags: string;
  followed_plan: boolean;
};

export type JournalRemote = {
  listEntries(): Promise<JournalEntry[]>;
  createEntry(draft: JournalDraft): Promise<JournalEntry>;
};

export function useJournalWorkspace(remote: JournalRemote) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [draft, setDraft] = useState<JournalDraft>({
    trade_date: todayIsoDate(),
    ticker: "",
    setup: "Catalyst momentum",
    catalyst_type: "",
    entry_price: "",
    stop_price: "",
    exit_price: "",
    shares: "",
    pnl: "",
    notes: "",
    mistake_tags: "",
    followed_plan: true,
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const values = await remote.listEntries();
    setEntries(values);
    return values;
  }, [remote]);

  const selectCandidate = useCallback((candidate: ScannerSymbol) => {
    setDraft((current) => ({
      ...current,
      ticker: candidate.ticker,
      catalyst_type: candidate.catalyst_type || "",
      entry_price: current.ticker === candidate.ticker ? current.entry_price : "",
      stop_price: current.ticker === candidate.ticker ? current.stop_price : "",
      exit_price: current.ticker === candidate.ticker ? current.exit_price : "",
    }));
  }, []);

  const startFromPlan = useCallback((plan: TradePlan, candidate: ScannerSymbol | null) => {
    setDraft((current) => ({
      ...current,
      trade_date: todayIsoDate(),
      ticker: plan.ticker,
      catalyst_type: candidate?.catalyst_type ?? current.catalyst_type,
      entry_price: String(plan.entry_price),
      stop_price: String(plan.stop_price),
      exit_price: "",
      shares: String(plan.shares),
      pnl: "",
      notes: "",
      mistake_tags: "",
      followed_plan: true,
    }));
  }, []);

  const save = useCallback(
    async (refresh: () => Promise<void>) => {
      setSaving(true);
      try {
        await remote.createEntry(draft);
        await refresh();
        setDraft((current) => ({
          ...current,
          exit_price: "",
          shares: "",
          pnl: "",
          notes: "",
          mistake_tags: "",
        }));
        return "Journal entry saved.";
      } finally {
        setSaving(false);
      }
    },
    [draft, remote],
  );

  return { entries, draft, setDraft, saving, load, selectCandidate, startFromPlan, save };
}

export type JournalWorkspaceController = ReturnType<typeof useJournalWorkspace>;

export function JournalWorkspace({
  journal,
  onSubmit,
  analyticsPresentation,
  riskPresentation,
}: {
  journal: JournalWorkspaceController;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  analyticsPresentation: ReactNode;
  riskPresentation: ReactNode;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0 space-y-4">
        <PageHeading
          eyebrow="Step 4 · Review"
          title="Trade journal"
          description="Record the actual execution, whether the plan was followed, and the mistake tags that matter."
        />
        <JournalPanel
          draft={journal.draft}
          setDraft={journal.setDraft}
          onSubmit={onSubmit}
          saving={journal.saving}
          entries={journal.entries}
        />
      </div>
      <aside className="space-y-4">
        {analyticsPresentation}
        {riskPresentation}
      </aside>
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

function TableHead({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-3 font-semibold">{children}</th>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function JournalPanel({
  draft,
  setDraft,
  onSubmit,
  saving,
  entries,
}: {
  draft: JournalDraft;
  setDraft: React.Dispatch<React.SetStateAction<JournalDraft>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  entries: JournalEntry[];
}) {
  return (
    <section className="panel overflow-hidden rounded-xl">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <BookOpen className="h-4 w-4 text-blue-700" />
        <h2 className="text-base font-semibold text-ink">Journal</h2>
      </div>
      <form className="grid gap-3 px-4 py-4 sm:grid-cols-2" onSubmit={onSubmit}>
        <Field label="Date">
          <input
            className="field"
            type="date"
            value={draft.trade_date}
            onChange={(event) => setDraft((current) => ({ ...current, trade_date: event.target.value }))}
          />
        </Field>
        <Field label="Ticker">
          <input
            className="field uppercase"
            value={draft.ticker}
            required
            onChange={(event) => setDraft((current) => ({ ...current, ticker: event.target.value.toUpperCase() }))}
          />
        </Field>
        <Field label="Setup">
          <input
            className="field"
            value={draft.setup}
            onChange={(event) => setDraft((current) => ({ ...current, setup: event.target.value }))}
          />
        </Field>
        <Field label="Catalyst">
          <input
            className="field"
            value={draft.catalyst_type}
            onChange={(event) => setDraft((current) => ({ ...current, catalyst_type: event.target.value }))}
          />
        </Field>
        <Field label="Entry">
          <input
            className="field"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={draft.entry_price}
            onChange={(event) => setDraft((current) => ({ ...current, entry_price: event.target.value }))}
          />
        </Field>
        <Field label="Stop">
          <input
            className="field"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={draft.stop_price}
            onChange={(event) => setDraft((current) => ({ ...current, stop_price: event.target.value }))}
          />
        </Field>
        <Field label="Exit">
          <input
            className="field"
            type="number"
            min="0.01"
            step="0.01"
            required
            value={draft.exit_price}
            onChange={(event) => setDraft((current) => ({ ...current, exit_price: event.target.value }))}
          />
        </Field>
        <Field label="Shares">
          <input
            className="field"
            type="number"
            min="1"
            step="1"
            required
            value={draft.shares}
            onChange={(event) => setDraft((current) => ({ ...current, shares: event.target.value }))}
          />
        </Field>
        <Field label="P&L override">
          <input
            className="field"
            type="number"
            step="0.01"
            value={draft.pnl}
            onChange={(event) => setDraft((current) => ({ ...current, pnl: event.target.value }))}
          />
        </Field>
        <Field label="Mistake tags">
          <input
            className="field"
            value={draft.mistake_tags}
            onChange={(event) => setDraft((current) => ({ ...current, mistake_tags: event.target.value }))}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input
            type="checkbox"
            checked={draft.followed_plan}
            onChange={(event) => setDraft((current) => ({ ...current, followed_plan: event.target.checked }))}
          />
          Followed plan
        </label>
        <div className="flex items-end">
          <button className="primary-button w-full" type="submit" disabled={saving}>
            <Plus className="h-4 w-4" />
            Add entry
          </button>
        </div>
        <div className="sm:col-span-2">
          <Field label="Notes">
            <textarea
              className="field min-h-20"
              value={draft.notes}
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
            />
          </Field>
        </div>
      </form>
      <div className="max-h-[360px] overflow-y-auto border-t border-line">
        {entries.slice(0, 8).map((entry) => (
          <div key={entry.id} className="grid gap-1 border-b border-line px-4 py-3 text-sm last:border-b-0">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-ink">
                {entry.trade_date} {entry.ticker}
              </span>
              <span className={entry.pnl >= 0 ? "font-semibold text-teal-700" : "font-semibold text-red-700"}>
                {currency(entry.pnl)} / {number(entry.r_multiple, 2)}R
              </span>
            </div>
            <div className="text-slate-500">
              {entry.setup} {entry.followed_plan ? "" : "/ rule break"}
            </div>
          </div>
        ))}
        {entries.length === 0 && <div className="px-4 py-4 text-sm text-slate-500">No journal entries saved.</div>}
      </div>
    </section>
  );
}
