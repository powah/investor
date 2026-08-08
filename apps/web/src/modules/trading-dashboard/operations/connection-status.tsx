import { useCallback, useMemo, useState, type ReactNode } from "react";
import { CloudDownload, Newspaper, Radio, RefreshCw, WalletCards } from "lucide-react";
import { apiMessage, connectionLabel, formatOperationTime } from "@/modules/trading-dashboard/operations/shared";
import type { IntegrationsStatus, ProviderConnectionStatus } from "@/types/trading";

export type ConnectionStatusRemote = {
  getIntegrationsStatus(): Promise<IntegrationsStatus>;
  probeCapabilities(): Promise<unknown[]>;
};

export function useConnectionStatusCapability(remote: ConnectionStatusRemote) {
  const [status, setStatus] = useState<IntegrationsStatus | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await remote.getIntegrationsStatus());
      return [] as string[];
    } catch (error) {
      return [`setup status: ${apiMessage(error)}`];
    }
  }, [remote]);

  const probeCapabilities = useCallback(
    async (refresh: () => Promise<void>) => {
      await remote.probeCapabilities();
      await refresh();
      return "Alpaca read endpoints and configured feeds were tested and recorded.";
    },
    [remote],
  );

  const brokerReady = useMemo(
    () => Boolean(status?.broker.enabled && status.broker.verification_status === "available"),
    [status],
  );

  return { status, brokerReady, load, probeCapabilities };
}

export function ConnectionStatusCapability({
  status,
  streamStatus,
  loading,
  action,
  onProbe,
  onRefresh,
}: {
  status: IntegrationsStatus | null;
  streamStatus: ReactNode;
  loading: boolean;
  action: string | null;
  onProbe: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  return (
    <>
      <section className="panel overflow-hidden rounded-xl" aria-labelledby="connection-status-heading">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 id="connection-status-heading" className="font-semibold text-ink">Setup status</h3>
            <p className="mt-1 text-sm text-slate-500">Credentials stay in server environment settings and are never shown here.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="text-button"
              type="button"
              disabled={loading || action === "capability-probe" || !status?.market_data.configured}
              onClick={() => void onProbe()}
            >
              <Radio className={`h-4 w-4 ${action === "capability-probe" ? "animate-pulse" : ""}`} aria-hidden="true" />
              {action === "capability-probe" ? "Testing access" : "Test Alpaca access"}
            </button>
            <button className="text-button" type="button" disabled={loading} onClick={() => void onRefresh()}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
              {loading ? "Checking" : "Refresh status"}
            </button>
          </div>
        </div>
        <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-5">
          <ConnectionCard title="Market data" connection={status?.market_data ?? null} icon={Radio} />
          <ConnectionCard title="News" connection={status?.news ?? null} icon={Newspaper} />
          <ConnectionCard title="SEC filings" connection={status?.filings ?? null} icon={CloudDownload} />
          <ConnectionCard title="Paper broker" connection={status?.broker ?? null} icon={WalletCards} />
          {streamStatus}
        </div>
      </section>
    </>
  );
}

function ConnectionCard({
  title,
  connection,
  icon: Icon,
}: {
  title: string;
  connection: ProviderConnectionStatus | null;
  icon: typeof Radio;
}) {
  const alpacaVerified = connection?.provider !== "alpaca" || connection.verification_status === "available";
  const ready = Boolean(connection?.configured && connection.enabled && alpacaVerified);
  const sipUnverified = Boolean(connection?.source_feed === "sip" && !connection.enabled);
  const configuredButUnavailable = Boolean(connection?.configured && !connection.enabled);
  const verifiedUnavailable = Boolean(
    connection?.verification_status === "unavailable" ||
      connection?.verification_status === "failed",
  );
  const notTested = Boolean(
    connection?.provider === "alpaca" &&
      connection.configured &&
      connection.verification_status === "not_tested",
  );
  return (
    <article className="rounded-xl border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className={`rounded-lg p-2 ${ready ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-500"}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${ready ? "bg-teal-50 text-teal-700" : "bg-amber-50 text-amber-800"}`}>
          {connection
            ? ready
              ? "Ready"
              : sipUnverified
                ? "Access unverified"
                : notTested
                  ? "Not tested"
                  : verifiedUnavailable
                    ? connection?.verification_status === "failed"
                      ? "Test failed"
                      : "Unavailable"
                : configuredButUnavailable
                  ? "Unavailable"
                  : "Needs setup"
            : "Checking"}
        </span>
      </div>
      <h4 className="mt-3 font-semibold text-ink">{title}</h4>
      <div className="mt-1 text-xs font-semibold text-slate-600">
        {connection ? connectionLabel(connection) : "Waiting for server status"}
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        {connection?.message ?? "This check runs only while Operations is open."}
      </p>
      {connection?.verification_message && (
        <p className="mt-2 border-t border-line pt-2 text-xs leading-5 text-slate-500">
          {connection.verification_message}
          {connection.verified_at ? ` Checked ${formatOperationTime(connection.verified_at)}.` : ""}
        </p>
      )}
    </article>
  );
}
