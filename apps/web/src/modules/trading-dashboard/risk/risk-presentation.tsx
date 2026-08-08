import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import { currency, number } from "@/lib/api";
import type { RiskSettings, RiskState } from "@/types/trading";

export function RiskPrinciplesPanel() {
  const principles = [
    "Every plan requires a stop before position sizing.",
    "Daily loss and trade-count limits override opportunity.",
    "Score prioritizes attention; it is never a buy signal.",
    "Wide spreads, weak catalysts, and VWAP failures require review.",
  ];
  return (
    <section className="panel rounded-xl p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-teal-700" aria-hidden="true" />
        <h3 className="font-semibold text-ink">Planning principles</h3>
      </div>
      <ul className="mt-4 space-y-3">
        {principles.map((principle) => (
          <li key={principle} className="flex gap-2 text-sm leading-6 text-slate-600">
            <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
            <span>{principle}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}


export function RiskStatePanel({ state, settings }: { state: RiskState | null; settings: RiskSettings | null }) {
  return (
    <section className="panel overflow-hidden rounded-xl">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <AlertTriangle className="h-4 w-4 text-amber-700" />
        <h2 className="text-base font-semibold text-ink">Daily Risk</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 px-4 py-4 text-sm">
        <div>
          <div className="label">Realized P&L</div>
          <div className={state && state.daily_realized_pnl < 0 ? "mt-1 font-semibold text-red-700" : "mt-1 font-semibold text-teal-700"}>
            {state ? currency(state.daily_realized_pnl) : "-"}
          </div>
        </div>
        <div>
          <div className="label">Loss room</div>
          <div className="mt-1 font-semibold text-ink">{state ? currency(state.daily_loss_remaining) : "-"}</div>
        </div>
        <div>
          <div className="label">Trades</div>
          <div className="mt-1 font-semibold text-ink">
            {state ? `${state.trades_today}/${state.max_trades_per_day}` : "-"}
          </div>
        </div>
        <div>
          <div className="label">Max risk</div>
          <div className="mt-1 font-semibold text-ink">{settings ? `${settings.max_risk_per_trade_pct}%` : "-"}</div>
        </div>
      </div>
      {state?.daily_lockout && (
        <div className="border-t border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          Daily lockout: Max daily loss reached.
        </div>
      )}
    </section>
  );
}
