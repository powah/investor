# Risk Rules

## Purpose

The risk engine is the most important part of the tool. It should prevent emotional, oversized, low-quality, stale-data, and duplicate trades. A score or catalyst never overrides a hard risk blocker.

This release supports decision assistance and guarded **paper** execution only. It does not support live orders.

## Core risk settings

User-configurable settings:

- Account size
- Max risk per trade
- Max daily loss
- Max number of trades per day
- Max consecutive losses
- Allowed trading hours
- Minimum score required to plan a trade
- Maximum spread allowed

Paper automation adds operational limits for:

- Maximum paper orders per day
- Maximum order notional
- Maximum execution-quote age
- Maximum deviation between the reviewed plan price and the current execution quote

## Position sizing formula

```text
Risk per share = Entry price - Stop price
Max cash risk = Account size * Risk percentage
Position size = Max cash risk / Risk per share
```

Example:

```text
Account size: $10,000
Risk per trade: 0.5% = $50
Entry: $4.20
Stop: $4.00
Risk per share: $0.20
Max position size: 250 shares
```

Sizing is calculated before an execution intent is created and revalidated before any paper submission. The broker's buying-power value is an additional constraint, not a replacement for strategy risk limits.

## Required warnings and blockers

The tool should warn or block planning or submission when:

- Stop price is missing or invalid relative to entry
- Risk per share is too large
- Position size exceeds the defined per-trade risk
- Order notional exceeds the automation cap
- Daily max loss has been hit
- Spread is too wide or unavailable
- Stock has no fresh catalyst
- Score is below the minimum threshold
- Stock is below VWAP when the strategy requires VWAP confirmation
- User has exceeded max trades or paper orders per day
- User has hit max consecutive losses
- The plan is no longer valid or has already produced an intent
- The execution quote is missing, stale, or too far from the reviewed entry
- The broker account is inactive, blocked, suspended, or lacks buying power
- The regular market session is closed
- Provider state cannot be reconciled confidently

Warnings require explicit acknowledgement during manual approval when the workflow allows them. Hard blockers cannot be acknowledged away.

## Suggested warning language

```text
Risk warning: Position size exceeds your defined max risk.
```

```text
Invalid trade plan: Stop price is missing.
```

```text
Caution: Spread is wider than your allowed threshold.
```

```text
Daily lockout: Max daily loss reached. No more trades today.
```

```text
Execution blocked: The IEX quote is stale or has moved too far from the reviewed plan.
```

## Data-source rules

The scanner and execution check intentionally use different free Alpaca feeds:

- `delayed_sip` is a consolidated US-market view with a 15-minute free-plan delay. It is appropriate for broad scanner context but cannot prove that a paper entry is still current.
- `iex` is real-time data from the IEX venue only. It is fresher but not consolidated and must not be described as NBBO or full-market SIP.
- External Alpaca headlines and SEC filings are research leads. They receive no catalyst score until a person reviews the source, chooses a catalyst type, and assigns quality.

The system stores source feed, event time, observation time, delay, consolidation status, and provider request ID where available. Missing or stale provenance should fail closed for execution.

## Hard automation invariants

The local paper vertical slice enforces these boundaries:

1. **Paper only.** The broker service accepts the exact `https://paper-api.alpaca.markets` endpoint. `ALLOW_LIVE_TRADING` must remain `false`; enabling it blocks this release.
2. **Disarmed by default.** Automation starts disabled, automatic submission starts disabled, and the kill switch starts engaged.
3. **Manual approval is mandatory.** Each intent must be approved explicitly. The setting cannot be changed to bypass approval.
4. **Limit orders only.** Market orders are not accepted. Extended-hours eligibility is disabled.
5. **Protected exits only.** An entry is sent as a bracket with take-profit plus stop-loss or as an OTO with stop protection.
6. **Recheck immediately before submit.** Plan, risk state, account flags, buying power, market clock, quote age, price deviation, daily order count, and notional limits are evaluated again. Kill state, quote freshness, and the daily reservation are serialized under one database execution gate shared with kill-switch updates.
7. **Stable identity.** Every intent has a deterministic `client_order_id` persisted before network submission.
8. **Reconcile before retry.** Existing Alpaca state is queried by client order ID. A timeout or connection loss after a write is an unknown outcome and must never trigger a blind duplicate submission.
9. **Audit transitions.** Intent creation, approval, block, submission, failure, and reconciliation decisions are recorded locally.
10. **Kill switch blocks new submissions.** Engaging it is not the same as canceling existing broker orders or closing positions; those require separate deliberate actions.
11. **Reconciliation stays on.** When the broker is safely configured for paper, the worker continues polling active/uncertain intents by deterministic client order ID even if automation, auto-submit, or the kill switch prevents new orders.
12. **Auto-submit has three independent gates.** The worker submits only already manually approved intents, and only when automation is enabled, auto-submit of approved intents is enabled, and the kill switch is released.
13. **Warnings cannot drift past approval.** If the current risk-warning set differs from the warnings a person acknowledged, approval is invalidated and the intent returns to review.
14. **Protection remains observable.** A filled bracket/OTO parent is not treated as complete while its child exits remain live. The worker confirms an active protective stop; missing or rejected protection engages the kill switch and records `protection_failed` until broker state is resolved.

Releasing the kill switch requires the explicit confirmation phrase shown in Operations. Arming it does not remove manual approval or any other guard.

The Docker worker runs a guarded cycle every `AUTOMATION_POLL_SECONDS`. Each cycle reconciles first. It does not import scanner snapshots, headlines, or SEC filings; those remain manual REST syncs from Operations. A worker-cycle failure is logged and the next cycle may reconcile state, but no ambiguous order write is blindly repeated.

## Paper-trading limitations

Alpaca paper trading is a simulation. It does not fully model market impact, information leakage, latency slippage, queue position, price improvement, regulatory fees, dividends, or real displayed liquidity. Small-cap halts, gaps, spread changes, and limited liquidity can make live outcomes materially worse.

Therefore:

- Paper fills must not be used to auto-enable live trading.
- A profitable paper result does not validate execution quality.
- Reconciliation and failure behavior matter as much as strategy results.
- The IEX-only execution quote may differ from the consolidated market.

## Hard rules for every plan

- Every trade plan must include a stop.
- Position size must be calculated before entry.
- Daily max loss must be visible and respected.
- Journal entries should record whether the plan was followed.
- External data must retain provenance and human review state.

## Future risk work

- Durable broker event streaming with reconnect and REST backfill
- Automatic paper fill and partial-fill journal import
- Screenshot capture and historical replay
- Rule-violation analytics across execution intents
- Failure drills for timeouts, stale quotes, provider outages, and partial fills
- Separate review of any hypothetical live architecture; live execution itself is not implemented
