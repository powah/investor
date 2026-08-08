import { useCallback, useState, type FormEvent } from "react";
import { Save, Settings } from "lucide-react";
import { RiskPrinciplesPanel, RiskStatePanel } from "@/modules/trading-dashboard/risk/risk-presentation";
import type { RiskSettings, RiskState } from "@/types/trading";

export type RiskDraft = {
  account_size: string;
  max_risk_per_trade_pct: string;
  max_daily_loss: string;
  max_trades_per_day: string;
  max_consecutive_losses: string;
  allowed_start_time: string;
  allowed_end_time: string;
  min_score_to_plan: string;
  max_spread_pct: string;
  max_position_shares: string;
  require_above_vwap: boolean;
};

export type RiskRulesRemote = {
  getSettings(): Promise<RiskSettings>;
  getState(): Promise<RiskState>;
  updateSettings(draft: RiskDraft): Promise<RiskSettings>;
};

export function riskSettingsPayload(draft: RiskDraft) {
  return {
    account_size: Number(draft.account_size),
    max_risk_per_trade_pct: Number(draft.max_risk_per_trade_pct),
    max_daily_loss: Number(draft.max_daily_loss),
    max_trades_per_day: Number(draft.max_trades_per_day),
    max_consecutive_losses: Number(draft.max_consecutive_losses),
    allowed_start_time: draft.allowed_start_time,
    allowed_end_time: draft.allowed_end_time,
    min_score_to_plan: Number(draft.min_score_to_plan),
    max_spread_pct: Number(draft.max_spread_pct),
    max_position_shares: Number(draft.max_position_shares),
    require_above_vwap: draft.require_above_vwap,
  };
}

function inputTime(value: string) {
  return value.slice(0, 5);
}

function toRiskDraft(settings: RiskSettings): RiskDraft {
  return {
    account_size: String(settings.account_size),
    max_risk_per_trade_pct: String(settings.max_risk_per_trade_pct),
    max_daily_loss: String(settings.max_daily_loss),
    max_trades_per_day: String(settings.max_trades_per_day),
    max_consecutive_losses: String(settings.max_consecutive_losses),
    allowed_start_time: inputTime(settings.allowed_start_time),
    allowed_end_time: inputTime(settings.allowed_end_time),
    min_score_to_plan: String(settings.min_score_to_plan),
    max_spread_pct: String(settings.max_spread_pct),
    max_position_shares: String(settings.max_position_shares),
    require_above_vwap: settings.require_above_vwap,
  };
}

export function useRiskRules(remote: RiskRulesRemote) {
  const [settings, setSettings] = useState<RiskSettings | null>(null);
  const [state, setState] = useState<RiskState | null>(null);
  const [draft, setDraft] = useState<RiskDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [settingsData, stateData] = await Promise.all([
      remote.getSettings(),
      remote.getState(),
    ]);
    setSettings(settingsData);
    setState(stateData);
    setDraft((current) => current ?? toRiskDraft(settingsData));
    return { settings: settingsData, state: stateData };
  }, [remote]);

  const save = useCallback(
    async (refresh: () => Promise<void>) => {
      if (!draft) {
        return null;
      }
      setSaving(true);
      try {
        await remote.updateSettings(draft);
        await refresh();
        return "Risk settings saved.";
      } finally {
        setSaving(false);
      }
    },
    [draft, remote],
  );

  return { settings, state, draft, setDraft, saving, load, save };
}

export type RiskRulesController = ReturnType<typeof useRiskRules>;

export function RiskRulesWorkspace({
  risk,
  onSubmit,
}: {
  risk: RiskRulesController;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0 space-y-4">
        <PageHeading
          eyebrow="Guardrails"
          title="Risk rules"
          description="Set these limits before the session. Planner sizing and warnings use them as the source of truth."
        />
        {risk.draft && (
          <RiskSettingsPanel
            draft={risk.draft}
            setDraft={risk.setDraft}
            onSubmit={onSubmit}
            saving={risk.saving}
          />
        )}
      </div>
      <aside className="space-y-4">
        <RiskPrinciplesPanel />
        <RiskStatePanel state={risk.state} settings={risk.settings} />
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

function RiskSettingsPanel({
  draft,
  setDraft,
  onSubmit,
  saving,
}: {
  draft: RiskDraft;
  setDraft: React.Dispatch<React.SetStateAction<RiskDraft | null>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  function patch(update: Partial<RiskDraft>) {
    setDraft((current) => (current ? { ...current, ...update } : current));
  }

  return (
    <section className="panel overflow-hidden rounded-xl">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Settings className="h-4 w-4 text-blue-700" />
        <h2 className="text-base font-semibold text-ink">Risk Settings</h2>
      </div>
      <form className="grid gap-3 px-4 py-4 sm:grid-cols-2" onSubmit={onSubmit}>
        <Field label="Account size">
          <input className="field" type="number" min="1" step="0.01" value={draft.account_size} onChange={(event) => patch({ account_size: event.target.value })} />
        </Field>
        <Field label="Risk %">
          <input
            className="field"
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            value={draft.max_risk_per_trade_pct}
            onChange={(event) => patch({ max_risk_per_trade_pct: event.target.value })}
          />
        </Field>
        <Field label="Daily loss">
          <input
            className="field"
            type="number"
            min="1"
            step="0.01"
            value={draft.max_daily_loss}
            onChange={(event) => patch({ max_daily_loss: event.target.value })}
          />
        </Field>
        <Field label="Max trades">
          <input
            className="field"
            type="number"
            min="1"
            step="1"
            value={draft.max_trades_per_day}
            onChange={(event) => patch({ max_trades_per_day: event.target.value })}
          />
        </Field>
        <Field label="Max losses">
          <input
            className="field"
            type="number"
            min="1"
            step="1"
            value={draft.max_consecutive_losses}
            onChange={(event) => patch({ max_consecutive_losses: event.target.value })}
          />
        </Field>
        <Field label="Min score">
          <input
            className="field"
            type="number"
            min="0"
            max="100"
            step="1"
            value={draft.min_score_to_plan}
            onChange={(event) => patch({ min_score_to_plan: event.target.value })}
          />
        </Field>
        <Field label="Max spread %">
          <input
            className="field"
            type="number"
            min="0.01"
            step="0.01"
            value={draft.max_spread_pct}
            onChange={(event) => patch({ max_spread_pct: event.target.value })}
          />
        </Field>
        <Field label="Max shares">
          <input
            className="field"
            type="number"
            min="1"
            step="1"
            value={draft.max_position_shares}
            onChange={(event) => patch({ max_position_shares: event.target.value })}
          />
        </Field>
        <Field label="Start">
          <input className="field" type="time" value={draft.allowed_start_time} onChange={(event) => patch({ allowed_start_time: event.target.value })} />
        </Field>
        <Field label="End">
          <input className="field" type="time" value={draft.allowed_end_time} onChange={(event) => patch({ allowed_end_time: event.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700 sm:col-span-2">
          <input
            type="checkbox"
            checked={draft.require_above_vwap}
            onChange={(event) => patch({ require_above_vwap: event.target.checked })}
          />
          Require VWAP confirmation
        </label>
        <button className="primary-button sm:col-span-2" type="submit" disabled={saving}>
          <Save className="h-4 w-4" />
          Save settings
        </button>
      </form>
    </section>
  );
}
