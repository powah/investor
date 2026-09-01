import { apiFetch } from "@/lib/api";
import type { WatchlistRemote } from "@/modules/trading-dashboard/watchlist/watchlist-workspace";
import type { WatchlistItem } from "@/types/trading";

export const httpWatchlistRemote: WatchlistRemote = {
  listItems: () => apiFetch<WatchlistItem[]>("/watchlist"),
  removeItem: (ticker) => apiFetch<void>(`/watchlist/${encodeURIComponent(ticker)}`, { method: "DELETE", emptyResponse: true }),
  saveNotes: (ticker, notes) =>
    apiFetch<WatchlistItem>("/watchlist", {
      method: "POST",
      body: JSON.stringify({ ticker, notes: notes || null }),
    }),
};
