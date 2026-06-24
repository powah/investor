from collections import Counter, defaultdict

from app.models.trading import JournalEntry


def summarize_journal(entries: list[JournalEntry]) -> dict:
    total_trades = len(entries)
    wins = [entry.pnl for entry in entries if entry.pnl > 0]
    losses = [entry.pnl for entry in entries if entry.pnl < 0]
    net_pnl = sum(entry.pnl for entry in entries)
    average_r = sum(entry.r_multiple for entry in entries) / total_trades if total_trades else 0

    pnl_by_catalyst: dict[str, float] = defaultdict(float)
    mistake_counts: Counter[str] = Counter()
    for entry in entries:
        catalyst_type = entry.catalyst_type or "Unknown"
        pnl_by_catalyst[catalyst_type] += entry.pnl
        mistake_counts.update(entry.mistake_tags or [])

    best_catalyst_type = None
    if pnl_by_catalyst:
        best_catalyst_type = max(pnl_by_catalyst.items(), key=lambda item: item[1])[0]

    return {
        "total_trades": total_trades,
        "win_rate": round((len(wins) / total_trades) * 100, 2) if total_trades else 0,
        "average_win": round(sum(wins) / len(wins), 2) if wins else 0,
        "average_loss": round(sum(losses) / len(losses), 2) if losses else 0,
        "net_pnl": round(net_pnl, 2),
        "average_r": round(average_r, 2),
        "best_catalyst_type": best_catalyst_type,
        "most_common_mistake": mistake_counts.most_common(1)[0][0] if mistake_counts else None,
    }
