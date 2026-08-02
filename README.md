# Small-Cap Catalyst Momentum Trading Tool

A private, local-first trading workspace for scanning, ranking, planning, journaling, and cautiously paper-testing small-cap catalyst momentum trades.

The tool helps answer:

> Which small-cap stocks are worth watching today, why are they moving, where is the risk, and is the trade valid?

It is not a guaranteed trading system, signal service, or live trading bot. External headlines and filings are research inputs, not verified catalysts until a person reviews and promotes them. Paper results are simulations and should not be treated as evidence that live execution will behave the same way.

## Current implementation

The repository contains a usable local workflow from discovery through guarded paper execution:

- Accessible Scanner, Watchlist, Trade planner, Journal, Analytics, Operations, and Risk rules workspaces.
- Ranked scanner with search, workflow filters, CSV upload, score evidence, catalyst history, and risk warnings.
- Watch/unwatch state, persisted watch notes, and direct Watchlist → Planner → Journal handoffs.
- Pre-trade sizing with entry, stop, target, position size, max loss, R multiple, warnings, and hard blockers.
- Trade plans, journal entries, process tags, plan-adherence tracking, and basic analytics.
- Free external-data adapters for Alpaca Basic market snapshots and news plus public SEC EDGAR submissions.
- Persisted source provenance, timestamps, delay/consolidation labels, provider request IDs, and manual promotion of external events into scored catalysts.
- Alembic-managed database migrations, operational/demo data isolation, and persisted read-only Alpaca capability checks.
- A swappable broker contract with an Alpaca paper adapter for account, market clock, positions, orders, deterministic client-order lookup, protected limit-order submission, cancellation, and reconciliation.
- A guarded execution-intent workflow with audit records. It starts disabled, with the kill switch engaged, automatic submission disabled, and manual approval mandatory.
- A dedicated local worker that consumes Alpaca paper `trade_updates`, durably stores and deduplicates order/fill events, recovers unapplied events after restart, and runs REST backfill before every reconnect.
- The same worker still polls paper execution state every `AUTOMATION_POLL_SECONDS` as an independent recovery path. It reconciles active intents even while submission is disarmed.

The paper-execution slice accepts limit orders with bracket or OTO protection only. It does not blindly retry an order after a timeout or uncertain response; it reconciles using the deterministic client order ID. Live execution is hard-disabled in this release.

## Free data path

The two configured stock feeds serve different purposes and must not be treated as interchangeable:

| Purpose | Default source | Timing | Market coverage | Intended use |
| --- | --- | --- | --- | --- |
| Scanner research | Alpaca `delayed_sip` | 15-minute delayed | Consolidated US SIP | Broad market context, ranking, and review |
| Paper execution checks | Alpaca `iex` | Real time | IEX only; not consolidated | Freshness/deviation checks before a paper order |
| Headlines | Alpaca News REST | Provider/account dependent | Symbol-linked news | Human catalyst review |
| Filings | SEC EDGAR public APIs | Poll-based | SEC submissions | Human filing/catalyst review |

Real-time IEX represents one exchange and is not an NBBO or full-market SIP view. Delayed SIP is consolidated but stale by design, so it is not used as the execution quote. This project does not claim paid real-time SIP, paid news, or continuous market/news streaming support. Its WebSocket use is limited to paper-account order events.

## Local-first stack

```text
Frontend: Next.js + TypeScript + TailwindCSS
Backend: Python FastAPI
Database: PostgreSQL
Charts: TradingView Lightweight Charts
Runtime: Docker Compose
```

## Configure and run

Install Docker, then create a local environment file from the repository root:

```bash
cp .env.example .env
```

Edit `.env` and add:

```dotenv
APP_MODE=operational
ALPACA_API_KEY_ID=your-paper-key-id
ALPACA_API_SECRET_KEY=your-paper-secret-key
SEC_USER_AGENT=Your Name your-contact-email@example.com
```

Create free **paper** credentials in the Alpaca dashboard; paper and live credentials are different. Use a real, contactable identity for `SEC_USER_AGENT`, as required by SEC fair-access guidance. Keep these safety settings unchanged:

```dotenv
ALPACA_TRADING_BASE_URL=https://paper-api.alpaca.markets
ALPACA_TRADE_STREAM_URL=wss://paper-api.alpaca.markets/stream
ALPACA_SCANNER_FEED=delayed_sip
ALPACA_EXECUTION_FEED=iex
ALLOW_LIVE_TRADING=false
```

Start or rebuild the stack after changing `.env`:

```bash
docker compose up --build
```

Compose runs database migrations before starting the API. Operational mode never auto-loads
sample scanner candidates. Set `APP_MODE=demo` only when you deliberately want the sample-data
workspace; automatically seeded demo rows stay hidden after returning to operational mode.

Local URLs:

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API health check: http://localhost:8000/health

Docker publishes the web app, API, and PostgreSQL on `127.0.0.1` only. This local release does not implement user authentication or CSRF protection, so do not expose these ports through a LAN bind, reverse proxy, tunnel, or public host. A remotely reachable deployment requires an authenticated operator boundary, CSRF protection, TLS, and secrets management first.

Open the **Operations** tab and run **Test Alpaca access** to verify and record the configured
market feeds, screeners, news endpoint, and paper account before provider features are reported
as ready. Then sync market/news/filing data, review the paper account and orders, and manage
guarded paper intents. External news and SEC records remain unscored until you review and promote
them as catalysts.

The web app calls the API through a same-origin `/api` proxy. Docker resolves that proxy to the API service, while local Next.js development defaults to `http://localhost:8000`.

## Paper automation safety

- Automation is disabled by default.
- The kill switch is engaged by default and blocks new submissions.
- Broker reconciliation remains active when safely configured for paper; disabling submission or engaging the kill switch does not abandon uncertain/open paper intents.
- Every execution intent requires explicit manual approval; that requirement cannot be disabled.
- Only limit entries with a stop-protected bracket or OTO order are supported. Extended-hours execution is disabled.
- Fresh-quote, price-deviation, account, clock, plan, daily-risk, order-count, and notional guards are rechecked at submission time.
- Kill state, final quote freshness, approval warnings, and the daily submission reservation are serialized through one database execution gate immediately before the broker request.
- Every intent receives a stable client order ID. Existing provider state is looked up and reconciled before any uncertain order is considered for submission again.
- A timeout after an order write is an unknown outcome, not permission to retry.
- WebSocket order events are committed to an immutable inbox before execution state is applied. Provider event IDs and database uniqueness make replays idempotent.
- A worker restart first reprocesses durable-but-unapplied events, then backfills recent paper orders through REST before opening or reopening the WebSocket.
- Filled bracket/OTO parents remain under reconciliation until a protective stop is confirmed and an exit leg closes the position. Missing or rejected protection engages the global kill switch and remains visible as `protection_failed`.
- The worker can auto-submit only an already manually approved intent, and only when automation is enabled, auto-submit is separately enabled, and the kill switch is released.
- Only the exact Alpaca paper endpoint is accepted. Setting `ALLOW_LIVE_TRADING=true` blocks this release rather than enabling live orders.

See [Risk Rules](docs/risk-rules.md) for the complete operational boundaries.

## Documentation

- [Domain language](CONTEXT.md)
- [Architectural decisions](docs/adr/)
- [Project plan](docs/project-plan.md)
- [MVP scope](docs/mvp-scope.md)
- [Technology stack](docs/tech-stack.md)
- [Scoring model](docs/scoring-model.md)
- [Risk rules](docs/risk-rules.md)
- [Local development](docs/local-development.md)
- [Cost plan](docs/cost-plan.md)
- [Roadmap](docs/roadmap.md)
- [Scanner completion plan](docs/scanner-completion-plan.md)

## Current limitations

- Historical candle replay and immutable date-scoped scanner sessions are not implemented.
- Market, news, and filing imports are manually triggered REST syncs. The background worker streams paper order events, but it is not a market/news streaming consumer.
- Alpaca News availability and freshness can vary with the free account entitlement.
- Paid real-time SIP is represented as unverified and disabled; configuration alone is never reported as entitlement.
- Automatic fill-to-journal import remains future work.
- Live broker execution and paid data are not implemented.

## Verify changes

Frontend:

```bash
cd apps/web
npm run typecheck
npm run lint
npm run build
```

Backend:

```bash
python3.14 -m venv .venv
.venv/bin/python -m pip install -r apps/api/requirements-dev.txt
cd apps/api
../../.venv/bin/alembic -c alembic.ini upgrade head
../../.venv/bin/python -m pytest -q
```

Python 3.14 is the supported backend development runtime; the API image is pinned to CPython 3.14.6. Recreate older virtual environments before installing the current dependency set.
