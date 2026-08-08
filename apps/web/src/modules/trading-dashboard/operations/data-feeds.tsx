import { useCallback, useState } from "react";
import { CloudDownload, Newspaper, Radio, RefreshCw } from "lucide-react";
import { currency, number } from "@/lib/api";
import {
  apiMessage,
  connectionLabel,
  formatOperationTime,
  marketFeedLabel,
  syncResultMessage,
  TableHead,
} from "@/modules/trading-dashboard/operations/shared";
import type { IntegrationSyncResult, IntegrationsStatus, MarketDataSnapshot } from "@/types/trading";

export type DataFeedRemote = {
  listMarketSnapshots(): Promise<MarketDataSnapshot[]>;
  syncMarketData(): Promise<IntegrationSyncResult>;
  syncNews(): Promise<IntegrationSyncResult>;
};

export function useDataFeedCapability(remote: DataFeedRemote) {
  const [snapshots, setSnapshots] = useState<MarketDataSnapshot[]>([]);

  const load = useCallback(async () => {
    try {
      setSnapshots(await remote.listMarketSnapshots());
      return [] as string[];
    } catch (error) {
      return [`market snapshots: ${apiMessage(error)}`];
    }
  }, [remote]);

  const syncMarketData = useCallback(
    async (refresh: () => Promise<void>) => {
      const result = await remote.syncMarketData();
      await refresh();
      return syncResultMessage(result, "Market data sync finished");
    },
    [remote],
  );

  const syncNews = useCallback(
    async (refresh: () => Promise<void>) => {
      const result = await remote.syncNews();
      await refresh();
      return syncResultMessage(result, "External event sync finished");
    },
    [remote],
  );

  return { snapshots, load, syncMarketData, syncNews };
}
export function DataFeedCapability({
  status,
  snapshots,
  action,
  onSyncMarket,
  onSyncNews,
}: {
  status: IntegrationsStatus | null;
  snapshots: MarketDataSnapshot[];
  action: string | null;
  onSyncMarket: () => Promise<void>;
  onSyncNews: () => Promise<void>;
}) {
  const marketReady = Boolean(
    status?.market_data.enabled &&
      status.market_data.verification_status === "available",
  );
  const newsReady = Boolean(
    (status?.news.enabled && status.news.verification_status === "available") ||
      status?.filings.enabled,
  );
  return (
    <section className="panel overflow-hidden rounded-xl" aria-labelledby="feed-operations-heading">
      <div className="border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <CloudDownload className="h-4 w-4 text-blue-700" aria-hidden="true" />
          <h3 id="feed-operations-heading" className="font-semibold text-ink">Free feed sync</h3>
        </div>
        <p className="mt-1 text-sm text-slate-500">Pull on demand while the free-source workflow is being validated.</p>
      </div>

      <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-slate-50 p-3">
          <div className="text-sm font-semibold text-ink">Market snapshots</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">
            {status?.market_data
              ? connectionLabel(status.market_data)
              : "Scanner sync uses the configured server-side feed."}
          </div>
          {status?.market_data.source_feed === "iex" && (
            <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs font-medium text-amber-900">
              IEX is one venue, not a consolidated spread or volume view.
            </div>
          )}
          {status?.market_data.source_feed === "sip" && !status.market_data.enabled && (
            <div className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-xs font-medium leading-5 text-amber-900">
              Real-time consolidated SIP is not part of the free setup. Sync stays disabled until paid access is configured and verified on the server.
            </div>
          )}
          <button
            className="primary-button mt-3 w-full"
            type="button"
            disabled={!marketReady || action === "market-sync"}
            onClick={() => void onSyncMarket()}
          >
            <RefreshCw className={`h-4 w-4 ${action === "market-sync" ? "animate-spin" : ""}`} aria-hidden="true" />
            {action === "market-sync" ? "Syncing market data" : "Sync market data"}
          </button>
        </div>

        <div className="rounded-xl border border-line bg-slate-50 p-3">
          <div className="text-sm font-semibold text-ink">News and SEC events</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">
            Imported items remain external events until you explicitly promote one.
          </div>
          <div className="mt-2 rounded-lg bg-blue-50 px-2.5 py-2 text-xs font-medium text-blue-900">
            Syncing never changes a scanner score by itself.
          </div>
          <button
            className="text-button mt-3 w-full justify-center"
            type="button"
            disabled={!newsReady || action === "news-sync"}
            onClick={() => void onSyncNews()}
          >
            <Newspaper className="h-4 w-4" aria-hidden="true" />
            {action === "news-sync" ? "Syncing events" : "Sync external events"}
          </button>
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-semibold text-ink">Latest stored snapshots</h4>
          <span className="text-xs text-slate-500">{snapshots.length} symbols</span>
        </div>
        {snapshots.length ? (
          <div className="mt-3 overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.08em] text-slate-500">
                <tr>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Bid / ask</TableHead>
                  <TableHead>Volume / VWAP</TableHead>
                  <TableHead>Feed</TableHead>
                  <TableHead>As of</TableHead>
                </tr>
              </thead>
              <tbody>
                {snapshots.slice(0, 12).map((snapshot) => (
                  <tr key={snapshot.id} className="border-t border-line bg-white">
                    <td className="px-3 py-3 font-semibold text-ink">{snapshot.ticker}</td>
                    <td className="px-3 py-3 text-ink">{currency(snapshot.price)}</td>
                    <td className="px-3 py-3 text-slate-600">
                      {snapshot.bid == null || snapshot.ask == null
                        ? "—"
                        : `${currency(snapshot.bid)} / ${currency(snapshot.ask)}`}
                      <span className="block text-xs text-slate-400">
                        {snapshot.spread_pct == null ? "Spread unavailable" : `${number(snapshot.spread_pct, 2)}% spread`}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {snapshot.volume == null ? "—" : number(snapshot.volume, 0)}
                      <span className="block text-xs text-slate-400">
                        {snapshot.vwap == null ? "VWAP unavailable" : `${currency(snapshot.vwap)} VWAP`}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                        {marketFeedLabel(snapshot.source_feed, snapshot.is_consolidated, snapshot.delay_seconds)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500">{formatOperationTime(snapshot.event_time)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-3 rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            No external snapshots stored yet. Sync when the market provider is ready.
          </div>
        )}
      </div>
    </section>
  );
}
