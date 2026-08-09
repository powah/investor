import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, Calculator, CheckCircle2, Save, ShieldCheck } from "lucide-react";
import { currency, number, todayIsoDate } from "@/lib/api";
import { calculatePlanPreview, type PlanDraft, type PlanPreview } from "@/modules/trading-dashboard/planner/plan-preview";
import type { RiskSettings, RiskState, ScannerSymbol, TradePlan } from "@/types/trading";

export type PlannerRemote = {
  listPlans(): Promise<TradePlan[]>;
  createPlan(draft: PlanDraft): Promise<TradePlan>;
};

export function usePlannerWorkspace(
  remote: PlannerRemote,
  selectedCandidate: ScannerSymbol | null,
  riskSettings: RiskSettings | null,
  riskState: RiskState | null,
) {
  const [plans, setPlans] = useState<TradePlan[]>([]);
  const [draft, setDraft] = useState<PlanDraft>({
    plan_date: todayIsoDate(),
    ticker: "",
    account_size: "",
    max_risk_per_trade_pct: "",
    entry_price: "",
    stop_price: "",
    target_price: "",
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const values = await remote.listPlans();
    setPlans(values);
    return values;
  }, [remote]);

  const selectCandidate = useCallback(
    (candidate: ScannerSymbol, settings: RiskSettings | null = riskSettings) => {
      setDraft((current) => ({
        ...current,
        ticker: candidate.ticker,
        entry_price: candidate.price.toFixed(2),
        stop_price: current.ticker === candidate.ticker ? current.stop_price : "",
        target_price: current.ticker === candidate.ticker ? current.target_price : "",
        account_size: current.account_size || String(settings?.account_size ?? ""),
        max_risk_per_trade_pct:
          current.max_risk_per_trade_pct || String(settings?.max_risk_per_trade_pct ?? ""),
      }));
    },
    [riskSettings],
  );

  const preview = useMemo(
    () => calculatePlanPreview(draft, selectedCandidate, riskSettings, riskState),
    [draft, riskSettings, riskState, selectedCandidate],
  );

  const save = useCallback(
    async (refresh: () => Promise<void>) => {
      setSaving(true);
      try {
        await remote.createPlan(draft);
        await refresh();
        return "Trade plan saved.";
      } finally {
        setSaving(false);
      }
    },
    [draft, remote],
  );

  return { plans, draft, setDraft, saving, preview, load, selectCandidate, save };
}

export type PlannerWorkspaceController = ReturnType<typeof usePlannerWorkspace>;

export function PlannerWorkspace({
  planner,
  onSubmit,
  onJournal,
  candidatePresentation,
  riskPresentation,
}: {
  planner: PlannerWorkspaceController;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onJournal: (plan: TradePlan) => void;
  candidatePresentation: ReactNode;
  riskPresentation: ReactNode;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0 space-y-4">
        <PageHeading
          eyebrow="Step 3 · Define risk"
          title="Trade planner"
          description="Set entry, invalidation, and target. Position size is calculated from your risk rules before anything is saved."
        />
        <PlannerPanel
          draft={planner.draft}
          setDraft={planner.setDraft}
          onSubmit={onSubmit}
          saving={planner.saving}
          plans={planner.plans}
          canSubmit={planner.preview.ready && planner.preview.blockers.length === 0}
          onJournal={onJournal}
        />
      </div>
      <aside className="space-y-4 xl:sticky xl:top-[158px] xl:self-start">
        <PlanPreviewPanel preview={planner.preview} ticker={planner.draft.ticker} />
        {candidatePresentation}
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function PlanPreviewPanel({ preview, ticker }: { preview: PlanPreview; ticker: string }) {
  return (
    <section className="panel overflow-hidden rounded-xl">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Calculator className="h-4 w-4 text-blue-700" aria-hidden="true" />
        <div>
          <h3 className="font-semibold text-ink">Live risk preview</h3>
          <p className="text-xs text-slate-500">{ticker ? `Sizing ${ticker}` : "Choose a ticker"}</p>
        </div>
      </div>
      {!preview.ready ? (
        <div className="px-4 py-8 text-center">
          <ShieldCheck className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
          <div className="mt-3 font-semibold text-ink">Define entry and stop</div>
          <p className="mt-1 text-sm leading-6 text-slate-500">Sizing appears before save once the invalidation price is explicit.</p>
        </div>
      ) : (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-3">
            <PreviewStat label="Risk / share" value={currency(preview.riskPerShare)} />
            <PreviewStat label="Cash risk cap" value={currency(preview.cashRisk)} />
            <PreviewStat label="Position size" value={`${number(preview.shares, 0)} shares`} emphasize />
            <PreviewStat label="Max loss" value={currency(preview.maxLoss)} emphasize />
            <PreviewStat label="Reward" value={preview.rMultiple === null ? "No target" : `${number(preview.rMultiple, 2)}R`} />
            <PreviewStat label="Plan state" value={preview.blockers.length ? "Blocked" : preview.warnings.length ? "Review" : "Ready"} />
          </div>
          {preview.blockers.map((blocker) => (
            <div key={blocker} className="flex gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{blocker}</span>
            </div>
          ))}
          {preview.warnings.map((warning) => (
            <div key={warning} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{warning}</span>
            </div>
          ))}
          {preview.blockers.length === 0 && preview.warnings.length === 0 && (
            <div className="flex gap-2 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Plan fits the current risk rules.</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function PreviewStat({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="label">{label}</div>
      <div className={`mt-1 ${emphasize ? "text-lg" : "text-sm"} font-semibold text-ink`}>{value}</div>
    </div>
  );
}


function PlannerPanel({
  draft,
  setDraft,
  onSubmit,
  saving,
  plans,
  canSubmit,
  onJournal,
}: {
  draft: PlanDraft;
  setDraft: React.Dispatch<React.SetStateAction<PlanDraft>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  plans: TradePlan[];
  canSubmit: boolean;
  onJournal: (plan: TradePlan) => void;
}) {
  return (
    <section className="panel overflow-hidden rounded-xl">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Calculator className="h-4 w-4 text-blue-700" aria-hidden="true" />
        <div>
          <h3 className="font-semibold text-ink">Plan inputs</h3>
          <p className="text-xs text-slate-500">Use the live preview to review size and every rule before saving.</p>
        </div>
      </div>
      <form className="grid gap-3 px-4 py-4 sm:grid-cols-2" onSubmit={onSubmit}>
        <Field label="Date">
          <input
            className="field"
            type="date"
            value={draft.plan_date}
            onChange={(event) => setDraft((current) => ({ ...current, plan_date: event.target.value }))}
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
        <Field label="Account size">
          <input
            className="field"
            type="number"
            min="1"
            step="0.01"
            value={draft.account_size}
            onChange={(event) => setDraft((current) => ({ ...current, account_size: event.target.value }))}
          />
        </Field>
        <Field label="Risk per trade %">
          <input
            className="field"
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            value={draft.max_risk_per_trade_pct}
            onChange={(event) => setDraft((current) => ({ ...current, max_risk_per_trade_pct: event.target.value }))}
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
          <span className="mt-1 block text-xs text-slate-500">Scanner price is a reference—not an entry signal.</span>
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
        <Field label="Target">
          <input
            className="field"
            type="number"
            min="0.01"
            step="0.01"
            value={draft.target_price}
            onChange={(event) => setDraft((current) => ({ ...current, target_price: event.target.value }))}
          />
        </Field>
        <div className="flex items-end">
          <button className="primary-button w-full" type="submit" disabled={saving || !canSubmit}>
            <Save className="h-4 w-4" />
            {canSubmit ? "Save plan" : "Complete valid plan"}
          </button>
        </div>
      </form>
      <div className="max-h-[520px] overflow-y-auto border-t border-line">
        {plans.map((plan) => (
          <div key={plan.id} className="grid gap-3 border-b border-line px-4 py-3 text-sm last:border-b-0 sm:grid-cols-[1fr_auto]">
            <div>
              <div className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                <span>{plan.ticker} · {number(plan.shares, 0)} shares</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{plan.plan_date}</span>
              </div>
              <div className="mt-1 text-slate-500">
                Entry {currency(plan.entry_price)} · stop {currency(plan.stop_price)} · max loss {currency(plan.max_loss)}
              </div>
              {plan.warnings.map((warning) => (
                <div key={warning} className="mt-1 text-amber-700">{warning}</div>
              ))}
            </div>
            <div className="flex items-center gap-2 sm:flex-col sm:items-end">
              <div className="font-semibold text-slate-700">{plan.r_multiple ? `${number(plan.r_multiple, 2)}R` : "No target"}</div>
              <button className="text-button" type="button" onClick={() => onJournal(plan)}>
                Journal <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
        {plans.length === 0 && <div className="px-4 py-4 text-sm text-slate-500">No trade plans saved.</div>}
      </div>
    </section>
  );
}
