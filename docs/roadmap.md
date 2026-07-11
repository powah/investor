# Roadmap

Status labels describe the repository's current local implementation. “Implemented” does not mean production-ready or suitable for live capital.

## Phase 1: Local foundation

**Status: Implemented**

Deliverables:

- Repo structure
- Docker Compose
- PostgreSQL database
- FastAPI backend
- Next.js frontend
- Scanner table loaded from CSV

## Phase 2: Scoring and watchlist

**Status: Implemented**

Deliverables:

- 0–100 scoring model
- Score breakdown
- Watchlist save/remove
- Daily watchlist view

## Phase 3: Catalyst module

**Status: Implemented**

Deliverables:

- Manual catalyst input
- Catalyst categories
- Catalyst quality score
- Headline display and external-event review
- No-catalyst and stale-catalyst warnings

## Phase 4: Risk planner

**Status: Implemented**

Deliverables:

- Entry/stop/risk form
- Position sizing
- Max loss calculation
- Daily risk state
- Warnings and hard blockers

## Phase 5: Journal

**Status: Implemented**

Deliverables:

- Trade journal form
- Trade history
- Mistake tags
- Execution notes
- R multiple and plan-adherence capture

## Phase 6: Analytics

**Status: Implemented as a basic local feedback loop**

Deliverables:

- P&L summary
- Win rate
- Average R
- Catalyst breakdown
- Mistake frequency
- Rule-violation and plan-adherence review

## Phase 7: Historical/replay mode

**Status: Not implemented**

Planned deliverables:

- Immutable, date-scoped scanner sessions
- Historical candle import
- Trading-day replay
- Manual testing of scanner and plan logic against past sessions

## Phase 8: External data integration

**Status: Implemented as a guarded local vertical slice**

Delivered:

- Provider-neutral contracts and normalized provenance for market data, news, and filings.
- Manually triggered Alpaca Basic REST snapshot sync.
- Default consolidated, 15-minute delayed SIP scanner feed (`delayed_sip`).
- Default real-time IEX execution-check feed (`iex`), explicitly labeled non-consolidated.
- Alpaca News REST ingestion with pagination and provider/account entitlement errors surfaced to the user.
- Public SEC EDGAR ticker/submissions ingestion using a required contactable User-Agent and paced requests.
- Atomic feed-record/run completion, in-batch news deduplication, and date-aware SEC filing windows.
- Persisted market snapshots, external news/filing events, sync metadata, source timestamps, delay flags, consolidation flags, and request IDs.
- Human review and promotion of external events into scored catalyst records.
- Operations workspace for connection status and manual synchronization.

Not included in this phase:

- Paid real-time SIP or other paid feeds. Merely selecting `sip` is shown as entitlement-unverified and remains disabled.
- Continuous WebSocket market/news ingestion
- Automatic sentiment or catalyst-quality decisions
- Unattended scheduled ingestion

## Phase 9: Paper trading and guarded automation

**Status: Implemented as a guarded local vertical slice**

Delivered:

- A swappable `BrokerProvider` boundary and normalized account, clock, position, order, cancellation, and error records.
- Alpaca paper REST adapter with exact paper-endpoint enforcement.
- Paper account, clock, position, and order synchronization in Operations.
- Persistent execution intents linked one-to-one with trade plans.
- Limit entry orders with bracket or OTO protection only; no market or extended-hours orders.
- Disabled-by-default automation, an engaged-by-default kill switch, mandatory manual approval, order/notional limits, and audit logs.
- A Docker Compose worker that polls execution state, reconciles active paper intents before submission decisions, and remains fail-closed by default.
- Revalidation of plan/risk state, account state, market clock, quote freshness, and price deviation before submission.
- Deterministic client order IDs, lookup-before-submit, provider-order reconciliation, and explicit unknown-outcome handling.
- No blind retries after timeouts or other ambiguous order writes.
- A shared database execution gate that serializes kill-switch state and daily submission reservations immediately before dispatch.
- Monotonic reconciliation of partial fills and protected child legs. A missing/rejected protective stop engages the kill switch and stays visible for operator action.

Still planned within paper trading:

- Durable Trading API WebSocket event ingestion and reconnect backfill
- Automatic fill/partial-fill import into the journal
- Longer-running paper observation, failure drills, and reconciliation testing
- Richer order lifecycle and position analytics

Paper trading does not model all liquidity, queue, slippage, fee, or market-impact effects and cannot validate live behavior.

## Phase 10: Live execution, optional

**Status: Explicitly not implemented**

Live orders are hard-disabled. The current service accepts only the exact Alpaca paper endpoint with `ALLOW_LIVE_TRADING=false`; changing that flag or configuring a non-paper endpoint blocks broker execution rather than enabling it.

Possible future evaluation criteria, not current deliverables:

- A sustained and reviewed paper record
- Stable reconciliation and recovery under disconnect/failure tests
- Independently reviewed live-specific risk controls and operational procedures
- Separate credentials, explicit multi-step authorization, and a new deployment boundary
- Small-cap liquidity, slippage, halt, short-locate, and regulatory risk review

There is no committed date or automatic upgrade path from paper to live trading.
