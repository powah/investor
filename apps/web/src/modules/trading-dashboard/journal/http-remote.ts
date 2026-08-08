import { apiFetch } from "@/lib/api";
import type { JournalDraft, JournalRemote } from "@/modules/trading-dashboard/journal/journal-workspace";
import type { JournalEntry } from "@/types/trading";

function optionalNumber(value: string) {
  return value.trim() === "" ? undefined : Number(value);
}

function journalEntryPayload(draft: JournalDraft) {
  return {
    trade_date: draft.trade_date,
    ticker: draft.ticker.toUpperCase(),
    setup: draft.setup,
    catalyst_type: draft.catalyst_type || null,
    entry_price: Number(draft.entry_price),
    stop_price: Number(draft.stop_price),
    exit_price: Number(draft.exit_price),
    shares: Number(draft.shares),
    pnl: optionalNumber(draft.pnl),
    notes: draft.notes || null,
    mistake_tags: draft.mistake_tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    followed_plan: draft.followed_plan,
  };
}

export const httpJournalRemote: JournalRemote = {
  listEntries: () => apiFetch<JournalEntry[]>("/journal"),
  createEntry: (draft) =>
    apiFetch<JournalEntry>("/journal", {
      method: "POST",
      body: JSON.stringify(journalEntryPayload(draft)),
    }),
};
