import { useCallback, useState, type FormEvent } from "react";
import { CircleStop, LockKeyhole, Play, Power, Save, ShieldCheck, SlidersHorizontal, Unplug } from "lucide-react";
import type { AutomationDraft } from "@/modules/trading-dashboard/contracts";
import { apiMessage, Field } from "@/modules/trading-dashboard/operations/shared";
import type { AutomationRun, AutomationSettings, ProviderConnectionStatus } from "@/types/trading";

export type AutomationRemote = {
  getAutomationSettings(): Promise<AutomationSettings>;
  updateAutomationSettings(draft: AutomationDraft): Promise<AutomationSettings>;
  updateKillSwitch(engaged: boolean, confirmation: string): Promise<AutomationSettings>;
  runAutomation(): Promise<AutomationRun>;
};

export function PaperOnlyBoundary({ broker }: { broker: ProviderConnectionStatus | null }) {
  const brokerReady = Boolean(broker?.enabled && broker.verification_status === "available");
  return (
    <section className="overflow-hidden rounded-xl border border-teal-200 bg-teal-50" aria-label="Paper trading safety boundary">
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-teal-700 p-2 text-white">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold text-teal-950">Paper trading only</h3>
              <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-teal-800 ring-1 ring-teal-200">
                No live orders
              </span>
            </div>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-teal-900">
              Orders can only target the Alpaca paper environment. Paper fills are simulated but still change that account. Every order starts as a draft, warnings require acknowledgement, and submission remains behind the kill switch.
            </p>
            <p className="mt-1 max-w-4xl text-xs leading-5 text-teal-800">
              Local-use preview: there is no sign-in or network access control in this app yet. Keep it on your own computer and do not expose it to the internet or a shared network.
            </p>
          </div>
        </div>
        <div className="shrink-0 text-sm font-semibold text-teal-900">
          {brokerReady ? "Paper broker verified" : "Paper broker unavailable"}
        </div>
      </div>
    </section>
  );
}
export function useAutomationCapability(remote: AutomationRemote) {
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
  const [draft, setDraft] = useState<AutomationDraft | null>(null);
  const [killConfirmation, setKillConfirmation] = useState("");

  const load = useCallback(async () => {
    try {
      const value = await remote.getAutomationSettings();
      setSettings(value);
      setDraft(toAutomationDraft(value));
      return [] as string[];
    } catch (error) {
      return [`automation controls: ${apiMessage(error)}`];
    }
  }, [remote]);

  const saveSettings = useCallback(async () => {
    if (!draft) {
      return null;
    }
    const updated = await remote.updateAutomationSettings(draft);
    setSettings(updated);
    setDraft(toAutomationDraft(updated));
    return "Paper automation settings saved. The kill switch remains the final authority.";
  }, [draft, remote]);

  const updateKillSwitch = useCallback(
    async (engaged: boolean) => {
      const updated = await remote.updateKillSwitch(engaged, killConfirmation);
      setSettings(updated);
      setDraft(toAutomationDraft(updated));
      setKillConfirmation("");
      return engaged
        ? "Kill switch engaged. Paper order submission is paused."
        : "Kill switch released for paper trading only.";
    },
    [killConfirmation, remote],
  );

  const runAutomation = useCallback(
    async (refresh: () => Promise<void>) => {
      const result = await remote.runAutomation();
      await refresh();
      return `Paper run processed ${result.processed}, submitted ${result.submitted}, reconciled ${result.reconciled}, failed ${result.failed}.`;
    },
    [remote],
  );

  return {
    settings,
    draft,
    setDraft,
    killConfirmation,
    setKillConfirmation,
    killSwitchEngaged: settings?.kill_switch_engaged ?? true,
    paperOnly: settings?.paper_only ?? true,
    load,
    saveSettings,
    updateKillSwitch,
    runAutomation,
  };
}

function toAutomationDraft(settings: AutomationSettings): AutomationDraft {
  return {
    enabled: settings.enabled,
    auto_submit_approved: settings.auto_submit_approved,
    require_manual_approval: settings.require_manual_approval,
    max_orders_per_day: String(settings.max_orders_per_day),
    max_order_notional: String(settings.max_order_notional),
    max_quote_age_seconds: String(settings.max_quote_age_seconds),
    max_price_deviation_pct: String(settings.max_price_deviation_pct),
  };
}


export function AutomationCapability({
  settings,
  draft,
  setDraft,
  action,
  killSwitchEngaged,
  killConfirmation,
  setKillConfirmation,
  onSave,
  onKillSwitch,
  onRun,
  brokerReady,
}: {
  settings: AutomationSettings | null;
  draft: AutomationDraft | null;
  setDraft: React.Dispatch<React.SetStateAction<AutomationDraft | null>>;
  action: string | null;
  killSwitchEngaged: boolean;
  killConfirmation: string;
  setKillConfirmation: (value: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onKillSwitch: (engaged: boolean) => Promise<void>;
  onRun: () => Promise<void>;
  brokerReady: boolean;
}) {
  function patch(update: Partial<AutomationDraft>) {
    setDraft((current) => (current ? { ...current, ...update } : current));
  }

  return (
    <section className="panel overflow-hidden rounded-xl" aria-labelledby="automation-safety-heading">
      <div className={`border-b px-4 py-4 ${killSwitchEngaged ? "border-amber-200 bg-amber-50" : "border-teal-200 bg-teal-50"}`}>
        <div className="flex items-start gap-3">
          <div className={`rounded-lg p-2 text-white ${killSwitchEngaged ? "bg-amber-700" : "bg-teal-700"}`}>
            {killSwitchEngaged ? <CircleStop className="h-5 w-5" aria-hidden="true" /> : <Power className="h-5 w-5" aria-hidden="true" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="automation-safety-heading" className="font-semibold text-ink">Kill switch</h3>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${killSwitchEngaged ? "bg-white text-amber-900" : "bg-white text-teal-800"}`}>
                {killSwitchEngaged ? "Engaged · submissions paused" : "Released · paper only"}
              </span>
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              {killSwitchEngaged
                ? "Safe default: prepared and approved orders cannot be submitted."
                : "Paper submission is armed, subject to every risk, quote-age, and approval check."}
            </p>
          </div>
        </div>

        {killSwitchEngaged ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-white p-3">
            <label className="block text-xs font-semibold text-slate-700" htmlFor="kill-switch-confirmation">
              Type ARM PAPER AUTOMATION to release
            </label>
            <input
              id="kill-switch-confirmation"
              className="field mt-1"
              value={killConfirmation}
              autoComplete="off"
              onChange={(event) => setKillConfirmation(event.target.value)}
            />
            <button
              className="text-button mt-2 w-full justify-center"
              type="button"
              disabled={
                killConfirmation !== "ARM PAPER AUTOMATION" ||
                action === "kill-switch" ||
                !settings?.paper_only ||
                !brokerReady
              }
              onClick={() => void onKillSwitch(false)}
            >
              <LockKeyhole className="h-4 w-4" aria-hidden="true" />
              Release for paper only
            </button>
          </div>
        ) : (
          <button
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            type="button"
            disabled={action === "kill-switch"}
            onClick={() => void onKillSwitch(true)}
          >
            <Unplug className="h-4 w-4" aria-hidden="true" />
            Engage kill switch now
          </button>
        )}
      </div>

      {draft ? (
        <form className="grid gap-3 p-4 sm:grid-cols-2" onSubmit={onSave}>
          <div className="sm:col-span-2">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-blue-700" aria-hidden="true" />
              <h4 className="text-sm font-semibold text-ink">Paper automation limits</h4>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">These settings cannot enable live trading. Limit orders with day duration are the only order path.</p>
          </div>
          <Field label="Orders per day">
            <input
              className="field"
              type="number"
              min="1"
              max="50"
              value={draft.max_orders_per_day}
              onChange={(event) => patch({ max_orders_per_day: event.target.value })}
            />
          </Field>
          <Field label="Max order value">
            <input
              className="field"
              type="number"
              min="1"
              step="0.01"
              value={draft.max_order_notional}
              onChange={(event) => patch({ max_order_notional: event.target.value })}
            />
          </Field>
          <Field label="Max quote age (seconds)">
            <input
              className="field"
              type="number"
              min="5"
              max="900"
              value={draft.max_quote_age_seconds}
              onChange={(event) => patch({ max_quote_age_seconds: event.target.value })}
            />
          </Field>
          <Field label="Max price drift %">
            <input
              className="field"
              type="number"
              min="0.01"
              max="25"
              step="0.01"
              value={draft.max_price_deviation_pct}
              onChange={(event) => patch({ max_price_deviation_pct: event.target.value })}
            />
          </Field>
          <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm text-slate-700 sm:col-span-2">
            <input
              className="mt-0.5"
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => patch({ enabled: event.target.checked })}
            />
            <span><strong className="block text-ink">Enable paper automation runs</strong><span className="mt-0.5 block text-xs leading-5 text-slate-500">The kill switch and broker checks still apply.</span></span>
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm text-slate-700 sm:col-span-2">
            <input
              className="mt-0.5"
              type="checkbox"
              checked={draft.require_manual_approval}
              disabled
              readOnly
            />
            <span><strong className="block text-ink">Manual approval required</strong><span className="mt-0.5 block text-xs leading-5 text-slate-500">Every prepared order must pass Review and Approve in this paper release.</span></span>
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-line p-3 text-sm text-slate-700 sm:col-span-2">
            <input
              className="mt-0.5"
              type="checkbox"
              checked={draft.auto_submit_approved}
              onChange={(event) => patch({ auto_submit_approved: event.target.checked })}
            />
            <span><strong className="block text-ink">Submit already-approved paper orders during a run</strong><span className="mt-0.5 block text-xs leading-5 text-slate-500">This never bypasses approval, limits, or the kill switch.</span></span>
          </label>
          <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
            <button className="text-button justify-center" type="submit" disabled={action === "automation-settings"}>
              <Save className="h-4 w-4" aria-hidden="true" />
              Save automation limits
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={
                action === "automation-run" ||
                killSwitchEngaged ||
                !draft.enabled ||
                !brokerReady
              }
              onClick={() => void onRun()}
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              {action === "automation-run" ? "Running checks" : "Run paper automation"}
            </button>
          </div>
        </form>
      ) : (
        <div className="p-4 text-sm leading-6 text-slate-500">Automation controls are unavailable. Submission stays safely paused.</div>
      )}
    </section>
  );
}
