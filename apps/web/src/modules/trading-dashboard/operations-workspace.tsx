import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  AutomationCapability,
  PaperOnlyBoundary,
  useAutomationCapability,
} from "@/modules/trading-dashboard/operations/automation";
import {
  ConnectionStatusCapability,
  useConnectionStatusCapability,
} from "@/modules/trading-dashboard/operations/connection-status";
import {
  DataFeedCapability,
  useDataFeedCapability,
} from "@/modules/trading-dashboard/operations/data-feeds";
import {
  EventReviewCapability,
  useEventReviewCapability,
} from "@/modules/trading-dashboard/operations/event-review";
import {
  BrokerStreamCard,
  PaperExecutionCapability,
  usePaperExecutionCapability,
} from "@/modules/trading-dashboard/operations/paper-execution";
import { apiMessage, PageHeading } from "@/modules/trading-dashboard/operations/shared";
import type { OperationsRemote } from "@/modules/trading-dashboard/remote";
import type { ExternalNewsEvent, ExecutionIntent, TradePlan } from "@/types/trading";

export function OperationsWorkspace({
  remote,
  plans,
  onWorkspaceRefresh,
}: {
  remote: OperationsRemote;
  plans: TradePlan[];
  onWorkspaceRefresh: () => Promise<void>;
}) {
  const connectionStatus = useConnectionStatusCapability(remote);
  const dataFeeds = useDataFeedCapability(remote);
  const eventReview = useEventReviewCapability(remote);
  const automation = useAutomationCapability(remote);
  const paperExecution = usePaperExecutionCapability(remote, plans);
  const loadConnectionStatus = connectionStatus.load;
  const loadDataFeeds = dataFeeds.load;
  const loadEventReview = eventReview.load;
  const loadAutomation = automation.load;
  const loadPaperExecution = paperExecution.load;
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadOperations = useCallback(async () => {
    setLoading(true);
    const failures = (
      await Promise.all([
        loadConnectionStatus(),
        loadDataFeeds(),
        loadEventReview(),
        loadAutomation(),
        loadPaperExecution(),
      ])
    ).flat();

    setError(failures.length ? `Some operations data is unavailable — ${failures.join("; ")}` : null);
    setLoading(false);
  }, [
    loadAutomation,
    loadConnectionStatus,
    loadDataFeeds,
    loadEventReview,
    loadPaperExecution,
  ]);

  useEffect(() => {
    void loadOperations();
    // Integration calls are deliberately isolated to this lazy-mounted view.
  }, [loadOperations]);

  const runAction = useCallback(
    async (name: string, task: () => Promise<string | null | void>) => {
      setAction(name);
      setError(null);
      try {
        const message = await task();
        if (message) {
          setNotice(message);
        }
      } catch (actionError) {
        setError(apiMessage(actionError));
      } finally {
        setAction(null);
      }
    },
    [],
  );

  function saveAutomationSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runAction("automation-settings", automation.saveSettings);
  }

  return (
    <div className="space-y-5">
      <PageHeading
        eyebrow="Feeds and paper execution"
        title="Operations"
        description="Bring in free external data, review it before it affects scoring, and move saved plans through a guarded Alpaca paper-order workflow."
      />

      <PaperOnlyBoundary broker={connectionStatus.status?.broker ?? null} />

      {(error || notice) && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
            error ? "border-red-200 bg-red-50 text-red-800" : "border-teal-200 bg-teal-50 text-teal-800"
          }`}
          role={error ? "alert" : "status"}
          aria-live="polite"
        >
          {error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{error ?? notice}</span>
        </div>
      )}

      <ConnectionStatusCapability
        status={connectionStatus.status}
        streamStatus={<BrokerStreamCard stream={paperExecution.brokerStream} />}
        loading={loading}
        action={action}
        onProbe={() =>
          runAction("capability-probe", () => connectionStatus.probeCapabilities(loadOperations))
        }
        onRefresh={loadOperations}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <DataFeedCapability
          status={connectionStatus.status}
          snapshots={dataFeeds.snapshots}
          action={action}
          onSyncMarket={() =>
            runAction("market-sync", () => dataFeeds.syncMarketData(loadOperations))
          }
          onSyncNews={() =>
            runAction("news-sync", () => dataFeeds.syncNews(loadOperations))
          }
        />
        <AutomationCapability
          settings={automation.settings}
          draft={automation.draft}
          setDraft={automation.setDraft}
          action={action}
          killSwitchEngaged={automation.killSwitchEngaged}
          killConfirmation={automation.killConfirmation}
          setKillConfirmation={automation.setKillConfirmation}
          onSave={saveAutomationSettings}
          onKillSwitch={(engaged) =>
            runAction("kill-switch", () => automation.updateKillSwitch(engaged))
          }
          onRun={() =>
            runAction("automation-run", () => automation.runAutomation(loadOperations))
          }
          brokerReady={connectionStatus.brokerReady}
        />
      </div>

      <EventReviewCapability
        events={eventReview.events}
        drafts={eventReview.drafts}
        setDrafts={eventReview.setDrafts}
        action={action}
        onPromote={(event: ExternalNewsEvent) =>
          runAction(`promote-${event.id}`, () =>
            eventReview.promote(event, loadOperations, onWorkspaceRefresh),
          )
        }
      />

      <PaperExecutionCapability
        plans={plans}
        plansAwaitingPreparation={paperExecution.plansAwaitingPreparation}
        executions={paperExecution.executions}
        reviews={paperExecution.reviews}
        brokerSync={paperExecution.brokerSync}
        action={action}
        killSwitchEngaged={automation.killSwitchEngaged}
        paperOnly={automation.paperOnly}
        brokerReady={connectionStatus.brokerReady}
        onBrokerSync={() =>
          runAction("broker-sync", () => paperExecution.syncBroker(loadOperations))
        }
        onPrepare={(plan: TradePlan) =>
          runAction(`prepare-${plan.id}`, () =>
            paperExecution.prepareExecution(plan, loadOperations),
          )
        }
        onApprove={(execution: ExecutionIntent) =>
          runAction(`approve-${execution.id}`, () =>
            paperExecution.approveExecution(execution, loadOperations),
          )
        }
        onSubmit={(execution: ExecutionIntent) =>
          runAction(`submit-${execution.id}`, () =>
            paperExecution.submitExecution(execution, loadOperations),
          )
        }
      />
    </div>
  );
}
