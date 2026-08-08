import { useCallback, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  ClipboardList,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { currency, number } from "@/lib/api";
import {
  apiMessage,
  marketFeedLabel,
  PreviewStat,
  TableHead,
} from "@/modules/trading-dashboard/operations/shared";
import type {
  BrokerStreamState,
  BrokerSync,
  ExecutionAction,
  ExecutionIntent,
  TradePlan,
} from "@/types/trading";

export type PaperExecutionRemote = {
  listExecutions(): Promise<Array<ExecutionIntent | ExecutionAction>>;
  getBrokerStream(): Promise<BrokerStreamState>;
  syncBroker(): Promise<BrokerSync>;
  prepareExecution(tradePlanId: number): Promise<ExecutionIntent | ExecutionAction>;
  approveExecution(executionId: number): Promise<ExecutionIntent | ExecutionAction>;
  submitExecution(executionId: number): Promise<ExecutionIntent | ExecutionAction>;
};

type ExecutionReview = {
  blockers: string[];
  warnings: string[];
};

export function usePaperExecutionCapability(remote: PaperExecutionRemote, plans: TradePlan[]) {
  const [executions, setExecutions] = useState<ExecutionIntent[]>([]);
  const [reviews, setReviews] = useState<Record<number, ExecutionReview>>({});
  const [brokerSync, setBrokerSync] = useState<BrokerSync | null>(null);
  const [brokerStream, setBrokerStream] = useState<BrokerStreamState | null>(null);

  const load = useCallback(async () => {
    const [executionResult, streamResult] = await Promise.allSettled([
      remote.listExecutions(),
      remote.getBrokerStream(),
    ]);
    const failures: string[] = [];

    if (executionResult.status === "fulfilled") {
      const normalizedExecutions: ExecutionIntent[] = [];
      const nextReviews: Record<number, ExecutionReview> = {};
      executionResult.value.forEach((item) => {
        const normalized = normalizeExecutionResponse(item);
        normalizedExecutions.push(normalized.intent);
        if (normalized.blockers.length || normalized.warnings.length) {
          nextReviews[normalized.intent.id] = {
            blockers: normalized.blockers,
            warnings: normalized.warnings,
          };
        }
      });
      setExecutions(normalizedExecutions);
      setReviews((current) => ({ ...current, ...nextReviews }));
    } else {
      failures.push(`paper order queue: ${apiMessage(executionResult.reason)}`);
    }

    if (streamResult.status === "fulfilled") {
      setBrokerStream(streamResult.value);
    } else {
      failures.push(`order event stream: ${apiMessage(streamResult.reason)}`);
    }

    return failures;
  }, [remote]);

  const executionByPlan = useMemo(
    () => new Map(executions.map((execution) => [execution.trade_plan_id, execution])),
    [executions],
  );
  const plansAwaitingPreparation = useMemo(
    () => plans.filter((plan) => !executionByPlan.has(plan.id)),
    [executionByPlan, plans],
  );

  const storeExecutionResponse = useCallback((response: ExecutionIntent | ExecutionAction) => {
    const normalized = normalizeExecutionResponse(response);
    setExecutions((current) => [
      normalized.intent,
      ...current.filter((item) => item.id !== normalized.intent.id),
    ]);
    setReviews((current) => ({
      ...current,
      [normalized.intent.id]: {
        blockers: normalized.blockers,
        warnings: normalized.warnings,
      },
    }));
    return normalized;
  }, []);

  const syncBroker = useCallback(
    async (refresh: () => Promise<void>) => {
      const synced = await remote.syncBroker();
      setBrokerSync(synced);
      await refresh();
      return "Paper broker account, positions, and orders reconciled.";
    },
    [remote],
  );

  const prepareExecution = useCallback(
    async (plan: TradePlan, refresh: () => Promise<void>) => {
      const normalized = storeExecutionResponse(await remote.prepareExecution(plan.id));
      await refresh();
      return normalized.blockers.length
        ? `${plan.ticker} paper order prepared with blockers to resolve.`
        : `${plan.ticker} paper order prepared for review. Nothing was submitted.`;
    },
    [remote, storeExecutionResponse],
  );

  const approveExecution = useCallback(
    async (execution: ExecutionIntent, refresh: () => Promise<void>) => {
      const normalized = storeExecutionResponse(await remote.approveExecution(execution.id));
      await refresh();
      return normalized.blockers.length
        ? `${executionTicker(execution, plans)} still has execution blockers.`
        : `${executionTicker(execution, plans)} approved for paper submission. It has not been sent yet.`;
    },
    [plans, remote, storeExecutionResponse],
  );

  const submitExecution = useCallback(
    async (execution: ExecutionIntent, refresh: () => Promise<void>) => {
      const normalized = storeExecutionResponse(await remote.submitExecution(execution.id));
      const ticker = executionTicker(execution, plans);
      const status = normalized.intent.status;
      let notice: string;
      if (status === "submission_unknown") {
        notice = `${ticker} may have reached Alpaca, but the response was inconclusive. Do not retry; sync the paper account to reconcile it.`;
      } else if (status === "protection_failed") {
        notice = `${ticker} filled, but its protective order is not confirmed. Keep submissions paused and inspect the paper account now.`;
      } else if (status === "entry_filled_protected") {
        notice = `${ticker} filled in the paper account and broker protection is active.`;
      } else {
        const submittedStatuses = ["submitted", "accepted", "partially_filled", "filled"];
        notice =
          normalized.blockers.length || !submittedStatuses.includes(status)
            ? `${ticker} was not submitted. Review the current blockers.`
            : `${ticker} was sent to the Alpaca paper account.`;
      }
      await refresh();
      return notice;
    },
    [plans, remote, storeExecutionResponse],
  );

  return {
    executions,
    reviews,
    brokerSync,
    brokerStream,
    plansAwaitingPreparation,
    load,
    syncBroker,
    prepareExecution,
    approveExecution,
    submitExecution,
  };
}

function normalizeExecutionResponse(value: ExecutionIntent | ExecutionAction): ExecutionAction {
  if ("intent" in value) {
    return value;
  }
  return { intent: value, blockers: [], warnings: [] };
}


function executionTicker(execution: ExecutionIntent, plans: TradePlan[]) {
  return plans.find((plan) => plan.id === execution.trade_plan_id)?.ticker ?? `Plan ${execution.trade_plan_id}`;
}

function formatOperationTime(value: string | null) {
  if (!value) {
    return "—";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

function optionalCurrency(value: number | null) {
  return value == null ? "—" : currency(value);
}

function optionalQuantity(value: number | null) {
  return value == null ? "—" : number(value, 4);
}


export function BrokerStreamCard({ stream }: { stream: BrokerStreamState | null }) {
  const listening = stream?.status === "listening";
  const label = stream ? stream.status.replaceAll("_", " ") : "checking";
  const lastActivity = stream?.last_event_at ?? stream?.last_backfill_at ?? stream?.last_connected_at;
  return (
    <article className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className={`rounded-lg p-2 ${listening ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-500"}`}>
          <Activity className="h-4 w-4" aria-hidden="true" />
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${listening ? "bg-teal-50 text-teal-700" : "bg-amber-50 text-amber-800"}`}>
          {label}
        </span>
      </div>
      <h4 className="mt-3 font-semibold text-ink">Order events</h4>
      <div className="mt-1 text-xs font-semibold text-slate-600">
        {stream ? `${stream.events_processed} applied · ${stream.duplicate_events} replays ignored` : "Waiting for worker status"}
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        {stream?.last_error
          ? stream.last_error
          : lastActivity
            ? `Last activity ${new Date(lastActivity).toLocaleString()}. REST recovery runs before every reconnect.`
            : "The worker durably records Alpaca paper order and fill updates before applying them."}
      </p>
    </article>
  );
}


export function PaperExecutionCapability({
  plans,
  plansAwaitingPreparation,
  executions,
  reviews,
  brokerSync,
  action,
  killSwitchEngaged,
  paperOnly,
  brokerReady,
  onBrokerSync,
  onPrepare,
  onApprove,
  onSubmit,
}: {
  plans: TradePlan[];
  plansAwaitingPreparation: TradePlan[];
  executions: ExecutionIntent[];
  reviews: Record<number, ExecutionReview>;
  brokerSync: BrokerSync | null;
  action: string | null;
  killSwitchEngaged: boolean;
  paperOnly: boolean;
  brokerReady: boolean;
  onBrokerSync: () => Promise<void>;
  onPrepare: (plan: TradePlan) => Promise<void>;
  onApprove: (execution: ExecutionIntent) => Promise<void>;
  onSubmit: (execution: ExecutionIntent) => Promise<void>;
}) {
  return (
    <section className="panel overflow-hidden rounded-xl" aria-labelledby="paper-execution-heading">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-blue-700" aria-hidden="true" />
            <h3 id="paper-execution-heading" className="font-semibold text-ink">Paper execution queue</h3>
          </div>
          <p className="mt-1 text-sm text-slate-500">A saved plan never becomes an order without moving through each explicit stage.</p>
        </div>
        <button
          className="text-button"
          type="button"
          disabled={!brokerReady || action === "broker-sync"}
          onClick={() => void onBrokerSync()}
        >
          <RefreshCw className={`h-4 w-4 ${action === "broker-sync" ? "animate-spin" : ""}`} aria-hidden="true" />
          {action === "broker-sync" ? "Syncing paper account" : "Sync paper account"}
        </button>
      </div>

      <div className="grid grid-cols-3 border-b border-line bg-slate-50 text-center text-xs font-semibold text-slate-600">
        <div className="border-r border-line px-2 py-3"><span className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-slate-950 text-white">1</span>Prepare</div>
        <div className="border-r border-line px-2 py-3"><span className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-blue-700 text-white">2</span>Review / approve</div>
        <div className="px-2 py-3"><span className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-teal-700 text-white">3</span>Submit to paper</div>
      </div>

      <div className="grid gap-5 p-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(330px,0.75fr)]">
        <div className="min-w-0 space-y-4">
          <div>
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-ink">Saved plans awaiting preparation</h4>
              <span className="text-xs text-slate-500">{plansAwaitingPreparation.length} available</span>
            </div>
            {plansAwaitingPreparation.length ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {plansAwaitingPreparation.slice(0, 8).map((plan) => (
                  <article key={plan.id} className="rounded-xl border border-line bg-slate-50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-ink">{plan.ticker} · {number(plan.shares, 0)} shares</div>
                        <div className="mt-1 text-xs text-slate-500">Limit {currency(plan.entry_price)} · stop {currency(plan.stop_price)}</div>
                      </div>
                      <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200">Plan #{plan.id}</span>
                    </div>
                    {plan.warnings.length > 0 && (
                      <div className="mt-2 text-xs leading-5 text-amber-800">{plan.warnings.length} planning warning{plan.warnings.length === 1 ? "" : "s"} will carry into review.</div>
                    )}
                    <button
                      className="text-button mt-3 w-full justify-center"
                      type="button"
                      disabled={!brokerReady || action === `prepare-${plan.id}`}
                      onClick={() => void onPrepare(plan)}
                    >
                      <ClipboardList className="h-4 w-4" aria-hidden="true" />
                      {action === `prepare-${plan.id}` ? "Preparing checks" : "Prepare paper order"}
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-2 rounded-lg bg-slate-50 px-4 py-5 text-sm text-slate-500">
                {plans.length ? "Every saved plan already has an execution record." : "Save a valid trade plan before preparing a paper order."}
              </div>
            )}
          </div>

          <div className="border-t border-line pt-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-ink">Prepared and submitted orders</h4>
              <span className="text-xs text-slate-500">{executions.length} records</span>
            </div>
            {executions.length ? (
              <div className="mt-2 space-y-3">
                {executions.map((execution) => (
                  <ExecutionCard
                    key={execution.id}
                    execution={execution}
                    ticker={executionTicker(execution, plans)}
                    review={reviews[execution.id]}
                    action={action}
                    killSwitchEngaged={killSwitchEngaged}
                    paperOnly={paperOnly}
                    brokerReady={brokerReady}
                    onApprove={onApprove}
                    onSubmit={onSubmit}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-2 rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                No paper order has been prepared.
              </div>
            )}
          </div>
        </div>

        <PaperBrokerPanel brokerSync={brokerSync} brokerReady={brokerReady} />
      </div>
    </section>
  );
}

function ExecutionCard({
  execution,
  ticker,
  review,
  action,
  killSwitchEngaged,
  paperOnly,
  brokerReady,
  onApprove,
  onSubmit,
}: {
  execution: ExecutionIntent;
  ticker: string;
  review: ExecutionReview | undefined;
  action: string | null;
  killSwitchEngaged: boolean;
  paperOnly: boolean;
  brokerReady: boolean;
  onApprove: (execution: ExecutionIntent) => Promise<void>;
  onSubmit: (execution: ExecutionIntent) => Promise<void>;
}) {
  const blockers = uniqueStrings([
    ...(review?.blockers ?? []),
    ...recordStrings(execution.risk_snapshot, "blockers"),
    ...recordStrings(execution.quote_snapshot, "blockers"),
  ]);
  const warnings = uniqueStrings([
    ...(review?.warnings ?? []),
    ...recordStrings(execution.risk_snapshot, "warnings"),
    ...recordStrings(execution.risk_snapshot, "plan_warnings"),
    ...recordStrings(execution.quote_snapshot, "warnings"),
  ]);
  const normalizedStatus = execution.status.toLowerCase();
  const isApproved = [
    "approved",
    "submitting",
    "submission_unknown",
    "submitted",
    "accepted",
    "partially_filled",
    "entry_filled_protected",
    "protection_failed",
    "filled",
    "canceled",
    "expired",
    "done_for_day",
    "replaced",
    "rejected",
  ].includes(normalizedStatus);
  const isBrokerConfirmed = [
    "submitted",
    "accepted",
    "partially_filled",
    "entry_filled_protected",
    "protection_failed",
    "filled",
    "canceled",
    "expired",
    "done_for_day",
    "replaced",
    "rejected",
  ].includes(normalizedStatus);
  const canApprove = ["pending_approval", "prepared", "draft", "blocked"].includes(normalizedStatus) && blockers.length === 0;
  const canSubmit = normalizedStatus === "approved" && !killSwitchEngaged && paperOnly && brokerReady;
  const quoteFeed = recordText(execution.quote_snapshot, "source_feed") || recordText(execution.quote_snapshot, "feed");
  const quoteAge = recordNumber(execution.quote_snapshot, "quote_age_seconds") ?? recordNumber(execution.quote_snapshot, "age_seconds");

  return (
    <article className={`rounded-xl border bg-white p-4 ${normalizedStatus === "protection_failed" ? "border-red-300" : "border-line"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h5 className="font-semibold text-ink">{ticker}</h5>
            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${executionStatusTone(normalizedStatus)}`}>
              {executionStatusLabel(normalizedStatus)}
            </span>
            <span className="rounded-full bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800">Paper</span>
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {number(execution.quantity, 0)} shares · limit {currency(execution.limit_price)} · day order
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Stop reference {currency(execution.stop_price)}
            {execution.target_price == null ? "" : ` · target ${currency(execution.target_price)}`}
          </div>
          {(quoteFeed || quoteAge != null) && (
            <div className="mt-2 text-xs font-medium text-slate-600">
              Quote check: {quoteFeed ? marketFeedLabel(quoteFeed) : "feed recorded"}{quoteAge == null ? "" : ` · ${number(quoteAge, 0)}s old`}
            </div>
          )}
        </div>
        <div className="grid min-w-[210px] grid-cols-3 gap-1 text-center text-[11px] font-semibold">
          <ExecutionStep label="Prepared" complete />
          <ExecutionStep label="Approved" complete={isApproved} />
          <ExecutionStep label="Broker confirmed" complete={isBrokerConfirmed} />
        </div>
      </div>

      {normalizedStatus === "submission_unknown" && (
        <div className="mt-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950">
          <Clock3 className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Alpaca may have accepted this order, but the app did not receive a conclusive response. Do not submit it again. Use “Sync paper account” and let reconciliation match the existing client order ID.</span>
        </div>
      )}
      {normalizedStatus === "entry_filled_protected" && (
        <div className="mt-3 flex gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm leading-6 text-teal-900">
          <ShieldCheck className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>The paper entry filled and Alpaca reports an active protective exit. Continue syncing until the position closes.</span>
        </div>
      )}
      {normalizedStatus === "protection_failed" && (
        <div className="mt-3 flex gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium leading-6 text-red-900" role="alert">
          <AlertTriangle className="mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>The paper entry may be open without confirmed stop protection. Engage the kill switch, inspect the Alpaca paper account, and manage the position manually before continuing.</span>
        </div>
      )}

      {blockers.map((blocker) => (
        <div key={blocker} className="mt-2 flex gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{blocker}</span>
        </div>
      ))}
      {warnings.map((warning) => (
        <div key={warning} className="mt-2 flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{warning}</span>
        </div>
      ))}
      {execution.failure_reason && (
        <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{execution.failure_reason}</div>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          className="text-button justify-center"
          type="button"
          disabled={!canApprove || action === `approve-${execution.id}`}
          onClick={() => void onApprove(execution)}
        >
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          {isApproved ? "Approved" : action === `approve-${execution.id}` ? "Reviewing" : warnings.length ? "Acknowledge & approve" : "Review & approve"}
        </button>
        <button
          className="primary-button"
          type="button"
          disabled={!canSubmit || action === `submit-${execution.id}`}
          onClick={() => void onSubmit(execution)}
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          {executionSubmitLabel(
            normalizedStatus,
            killSwitchEngaged,
            paperOnly,
            brokerReady,
            action === `submit-${execution.id}`,
          )}
        </button>
      </div>
    </article>
  );
}

function ExecutionStep({ label, complete }: { label: string; complete: boolean }) {
  return (
    <div className={`rounded-lg px-2 py-2 ${complete ? "bg-teal-50 text-teal-800" : "bg-slate-100 text-slate-500"}`}>
      {complete ? <CheckCircle2 className="mx-auto mb-1 h-3.5 w-3.5" aria-hidden="true" /> : <Clock3 className="mx-auto mb-1 h-3.5 w-3.5" aria-hidden="true" />}
      {label}
    </div>
  );
}

function PaperBrokerPanel({ brokerSync, brokerReady }: { brokerSync: BrokerSync | null; brokerReady: boolean }) {
  if (!brokerSync) {
    return (
      <aside className="rounded-xl border border-line bg-slate-50 p-4">
        <WalletCards className="h-5 w-5 text-blue-700" aria-hidden="true" />
        <h4 className="mt-3 font-semibold text-ink">Paper account</h4>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          {brokerReady
            ? "Use “Sync paper account” to retrieve current balances, positions, and order states."
            : "Configure the Alpaca paper connection on the server. No account secrets are entered in this app."}
        </p>
      </aside>
    );
  }

  const accountBlocked = brokerSync.account.trading_blocked || brokerSync.account.account_blocked || brokerSync.account.trade_suspended_by_user;
  return (
    <aside className="space-y-3">
      <div className="rounded-xl border border-line bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="label">Alpaca environment</div>
            <div className="mt-1 font-semibold capitalize text-ink">{brokerSync.account.environment}</div>
          </div>
          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${accountBlocked ? "bg-red-50 text-red-800" : "bg-teal-50 text-teal-800"}`}>
            {accountBlocked ? "Trading blocked" : brokerSync.account.status}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <PreviewStat label="Equity" value={optionalCurrency(brokerSync.account.equity)} />
          <PreviewStat label="Buying power" value={optionalCurrency(brokerSync.account.buying_power)} />
          <PreviewStat label="Cash" value={optionalCurrency(brokerSync.account.cash)} />
          <PreviewStat label="Market" value={brokerSync.clock.is_open ? "Open" : "Closed"} />
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          Broker time {formatOperationTime(brokerSync.clock.timestamp)} · next {brokerSync.clock.is_open ? "close" : "open"} {formatOperationTime(brokerSync.clock.is_open ? brokerSync.clock.next_close : brokerSync.clock.next_open)}
        </p>
      </div>

      <div className="rounded-xl border border-line bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-ink">Paper positions</h4>
          <span className="text-xs text-slate-500">{brokerSync.positions.length}</span>
        </div>
        <div className="mt-2 space-y-2">
          {brokerSync.positions.slice(0, 8).map((position) => (
            <div key={position.symbol} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold text-ink">{position.symbol} · {number(position.quantity, 4)}</span>
                <span className={position.unrealized_pl != null && position.unrealized_pl < 0 ? "font-semibold text-red-700" : "font-semibold text-teal-700"}>
                  {optionalCurrency(position.unrealized_pl)}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                Avg {optionalCurrency(position.average_entry_price)} · current {optionalCurrency(position.current_price)} · available {optionalQuantity(position.available_quantity)}
              </div>
            </div>
          ))}
          {!brokerSync.positions.length && <div className="text-sm text-slate-500">No open paper positions.</div>}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-ink">Recent paper orders</h4>
          <span className="text-xs text-slate-500">{brokerSync.orders.length}</span>
        </div>
        <div className="mt-2 space-y-2">
          {brokerSync.orders.slice(0, 8).map((order) => (
            <div key={order.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <div>
                <div className="font-semibold text-ink">{order.symbol || "Multi-leg order"} · {optionalQuantity(order.quantity)}</div>
                <div className="mt-1 text-xs uppercase text-slate-500">{order.order_type} · {order.time_in_force}</div>
              </div>
              <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold capitalize text-slate-700 ring-1 ring-slate-200">{order.status.replaceAll("_", " ")}</span>
            </div>
          ))}
          {!brokerSync.orders.length && <div className="text-sm text-slate-500">No paper orders returned.</div>}
        </div>
      </div>
    </aside>
  );
}

function executionStatusTone(status: string) {
  if (["filled", "entry_filled_protected", "accepted", "submitted", "approved"].includes(status)) {
    return "bg-teal-50 text-teal-800";
  }
  if (["protection_failed", "failed", "rejected", "canceled", "expired", "done_for_day", "replaced", "blocked"].includes(status)) {
    return "bg-red-50 text-red-800";
  }
  return "bg-amber-50 text-amber-800";
}

function executionStatusLabel(status: string) {
  if (status === "submission_unknown") {
    return "Submission unconfirmed";
  }
  if (status === "entry_filled_protected") {
    return "Entry filled · protection active";
  }
  if (status === "protection_failed") {
    return "Protection not confirmed";
  }
  return status.replaceAll("_", " ");
}

function executionSubmitLabel(
  status: string,
  killSwitchEngaged: boolean,
  paperOnly: boolean,
  brokerReady: boolean,
  isSubmitting: boolean,
) {
  if (status === "submission_unknown") {
    return "Awaiting reconciliation";
  }
  if (status === "entry_filled_protected") {
    return "Protection active";
  }
  if (status === "protection_failed") {
    return "Protection needs attention";
  }
  if (["submitted", "accepted", "partially_filled", "filled", "canceled", "expired", "done_for_day", "replaced", "rejected"].includes(status)) {
    return "Sent to paper account";
  }
  if (isSubmitting) {
    return "Submitting";
  }
  if (killSwitchEngaged) {
    return "Paused by kill switch";
  }
  if (!paperOnly) {
    return "Paper-only check failed";
  }
  if (!brokerReady) {
    return "Paper broker unavailable";
  }
  return "Submit to paper";
}

function recordStrings(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function recordText(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function recordNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" ? value : null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}
