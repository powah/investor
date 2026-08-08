import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, Eye, Save, Trash2 } from "lucide-react";
import type { ScannerSymbol, WatchlistItem } from "@/types/trading";

export type WatchlistRemote = {
  listItems(): Promise<WatchlistItem[]>;
  removeItem(ticker: string): Promise<void>;
  saveNotes(ticker: string, notes: string): Promise<WatchlistItem>;
};

export function useWatchlistWorkspace(remote: WatchlistRemote) {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const values = await remote.listItems();
    setItems(values);
    setNoteDrafts((current) => {
      const next = { ...current };
      values.forEach((item) => {
        if (!(item.ticker in next)) {
          next[item.ticker] = item.notes ?? "";
        }
      });
      return next;
    });
    return values;
  }, [remote]);

  const watchedTickers = useMemo(
    () => new Set(items.map((item) => item.ticker)),
    [items],
  );
  const ensureWatchedSelection = useCallback(
    (currentTicker: string, selectCandidate: (candidate: ScannerSymbol) => void) => {
      if (watchedTickers.has(currentTicker)) {
        return;
      }
      const firstCandidate = items.find((item) => item.symbol)?.symbol;
      if (firstCandidate) {
        selectCandidate(firstCandidate);
      }
    },
    [items, watchedTickers],
  );

  const remove = useCallback(
    async (ticker: string, refresh: () => Promise<void>) => {
      await remote.removeItem(ticker);
      await refresh();
      return `${ticker} removed from watchlist.`;
    },
    [remote],
  );

  const saveNote = useCallback(
    async (ticker: string, refresh: () => Promise<void>) => {
      await remote.saveNotes(ticker, noteDrafts[ticker] || "");
      await refresh();
      return `${ticker} watch notes saved.`;
    },
    [noteDrafts, remote],
  );

  const setNoteDraft = useCallback((ticker: string, value: string) => {
    setNoteDrafts((current) => ({ ...current, [ticker]: value }));
  }, []);

  return {
    items,
    watchedTickers,
    noteDrafts,
    setNoteDraft,
    load,
    ensureWatchedSelection,
    remove,
    saveNote,
  };
}

export type WatchlistWorkspaceController = ReturnType<typeof useWatchlistWorkspace>;

export function WatchlistWorkspace({
  workspace,
  selectedTicker,
  saving,
  onSelect,
  onRemove,
  onSaveNote,
  candidatePresentation,
}: {
  workspace: WatchlistWorkspaceController;
  selectedTicker: string;
  saving: string | null;
  onSelect: (symbol: ScannerSymbol) => void;
  onRemove: (ticker: string) => Promise<void>;
  onSaveNote: (ticker: string) => Promise<void>;
  candidatePresentation: ReactNode;
}) {
  const selectedItem = workspace.items.find((item) => item.ticker === selectedTicker) ?? null;
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0 space-y-4">
        <PageHeading
          eyebrow="Step 2 · Focus"
          title="Active watchlist"
          description="Keep only the names that deserve attention. Add levels and a no-trade condition before planning risk."
        />
        <WatchlistPanel
          items={workspace.items}
          watchedTickers={workspace.watchedTickers}
          onSelect={onSelect}
          onRemove={onRemove}
          saving={saving}
        />
        {selectedItem && (
          <WatchNotesPanel
            ticker={selectedItem.ticker}
            value={workspace.noteDrafts[selectedItem.ticker] ?? ""}
            onChange={(value) => workspace.setNoteDraft(selectedItem.ticker, value)}
            onSave={() => onSaveNote(selectedItem.ticker)}
            saving={saving === `note-${selectedItem.ticker}`}
          />
        )}
      </div>
      {candidatePresentation}
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

function scoreTone(score: number) {
  if (score >= 80) {
    return "bg-teal-50 text-teal-800 ring-teal-200";
  }
  if (score >= 65) {
    return "bg-blue-50 text-blue-800 ring-blue-200";
  }
  if (score >= 50) {
    return "bg-amber-50 text-amber-800 ring-amber-200";
  }
  return "bg-slate-100 text-slate-700 ring-slate-200";
}

function WatchNotesPanel({
  ticker,
  value,
  onChange,
  onSave,
  saving,
}: {
  ticker: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => Promise<void>;
  saving: boolean;
}) {
  return (
    <section className="panel rounded-xl">
      <div className="border-b border-line px-4 py-3">
        <h3 className="font-semibold text-ink">{ticker} watch notes</h3>
        <p className="mt-1 text-sm text-slate-500">Record the key level, invalidation, and what would make you stand aside.</p>
      </div>
      <div className="p-4">
        <textarea
          className="field min-h-28"
          value={value}
          placeholder="Example: Valid only above $3.20 with volume. No chase over $3.60. Invalid below VWAP."
          onChange={(event) => onChange(event.target.value)}
        />
        <div className="mt-3 flex justify-end">
          <button className="primary-button" type="button" disabled={saving} onClick={() => void onSave()}>
            <Save className="h-4 w-4" aria-hidden="true" />
            Save notes
          </button>
        </div>
      </div>
    </section>
  );
}


function WatchlistPanel({
  items,
  watchedTickers,
  onSelect,
  onRemove,
  saving,
}: {
  items: WatchlistItem[];
  watchedTickers: Set<string>;
  onSelect: (symbol: ScannerSymbol) => void;
  onRemove: (ticker: string) => Promise<void>;
  saving: string | null;
}) {
  return (
    <section className="panel overflow-hidden rounded-xl">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-blue-700" aria-hidden="true" />
          <h3 className="font-semibold text-ink">Names in focus</h3>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{items.length} active</span>
      </div>
      <div className="grid gap-3 p-3 sm:grid-cols-2">
        {items.map((item) => (
          <article key={item.id} className={`rounded-xl border p-4 ${watchedTickers.has(item.ticker) ? "border-blue-200 bg-blue-50/40" : "border-line bg-white"}`}>
            <div className="flex items-start justify-between gap-3">
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => item.symbol && onSelect(item.symbol)}
              disabled={!item.symbol}
            >
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold text-ink">{item.ticker}</span>
                {item.symbol && <span className={`rounded-md px-2 py-1 text-xs font-semibold ring-1 ${scoreTone(item.symbol.score)}`}>{item.symbol.score}</span>}
              </div>
              <div className="mt-1 text-sm text-slate-500">{item.symbol ? `${item.symbol.label} · ${item.symbol.above_vwap ? "above VWAP" : "below VWAP"}` : "Manual watch"}</div>
            </button>
            <button
              className="icon-button shrink-0"
              type="button"
              aria-label={`Remove ${item.ticker} from watchlist`}
              disabled={saving === `remove-${item.ticker}`}
              onClick={() => void onRemove(item.ticker)}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
            </div>
            {item.symbol && (
              <>
                <p className="mt-3 line-clamp-2 text-sm leading-5 text-slate-600">{item.symbol.news_headline || "No catalyst recorded"}</p>
                <button className="mt-3 flex items-center gap-1 text-sm font-semibold text-blue-700" type="button" onClick={() => onSelect(item.symbol!)}>
                  Open review <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </>
            )}
            {item.notes && <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs leading-5 text-slate-600">{item.notes}</p>}
          </article>
        ))}
        {items.length === 0 && (
          <div className="col-span-full px-4 py-12 text-center">
            <Eye className="mx-auto h-6 w-6 text-slate-400" aria-hidden="true" />
            <h3 className="mt-3 font-semibold text-ink">Watchlist is clear</h3>
            <p className="mt-1 text-sm text-slate-500">Return to the scanner and keep only names with a defensible catalyst and risk profile.</p>
          </div>
        )}
      </div>
    </section>
  );
}
