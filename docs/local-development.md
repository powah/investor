# Local Development

## Goal

Run the decision-support, free external-data, and guarded Alpaca paper workflow locally with no hosting or paid-data requirement.

## Local services

```text
Frontend: localhost:3000
Backend API: localhost:8000
PostgreSQL: localhost:5432
Redis: localhost:6379
Paper worker: background Docker service (no exposed port)
```

All published Compose ports are explicitly bound to `127.0.0.1`. The current UI and API have no login boundary and are intended for one operator on the same machine. Do not change those bindings to `0.0.0.0`, expose them through a tunnel, or place them behind a public reverse proxy. Remote deployment is a separate phase requiring authenticated operator roles, CSRF protection, TLS, and managed secrets.

Docker Compose is the supported full-stack path. The browser sends `/api/*` requests to the Next.js origin; Next.js proxies them to the FastAPI service.

## First-time setup

From the repository root, copy the environment template:

```bash
cp .env.example .env
```

The backend targets Python 3.14, matching the CPython 3.14.6 API image in `apps/api/Dockerfile`. For host-side tests, create the environment with Python 3.14 rather than reusing an older `.venv`:

```bash
python3.14 -m venv .venv
.venv/bin/python -m pip install -r apps/api/requirements.txt
```

The `.env` file is ignored by Git. Never commit API keys or paste them into browser-side code.

Create a free Alpaca paper account/key pair and set a contactable SEC identity:

```dotenv
ALPACA_API_KEY_ID=your-paper-key-id
ALPACA_API_SECRET_KEY=your-paper-secret-key
SEC_USER_AGENT=Your Name your-contact-email@example.com
```

Paper credentials must come from the Alpaca paper dashboard, not a live account. The SEC User-Agent should identify a real person or application and a monitored email address.

Keep the free-feed and paper-safety defaults:

```dotenv
ALPACA_TRADING_BASE_URL=https://paper-api.alpaca.markets
ALPACA_DATA_BASE_URL=https://data.alpaca.markets
ALPACA_SCANNER_FEED=delayed_sip
ALPACA_EXECUTION_FEED=iex
ALLOW_LIVE_TRADING=false
```

Start the stack:

```bash
docker compose up --build
```

After changing `.env`, restart/recreate the services so the API receives the new values:

```bash
docker compose up --build --force-recreate
```

Do not add `-v` when restarting unless you intentionally want to delete the PostgreSQL volume and all local records.

## Environment settings

| Setting | Safe local value | Meaning |
| --- | --- | --- |
| `ALPACA_API_KEY_ID` | Paper key ID | Authenticates Alpaca data, news, and paper Trading API calls |
| `ALPACA_API_SECRET_KEY` | Paper secret | Server-side secret; never exposed to the frontend |
| `ALPACA_TRADING_BASE_URL` | `https://paper-api.alpaca.markets` | The only broker endpoint accepted by this release |
| `ALPACA_DATA_BASE_URL` | `https://data.alpaca.markets` | Alpaca REST market/news API |
| `ALPACA_SCANNER_FEED` | `delayed_sip` | 15-minute delayed consolidated scanner snapshots |
| `ALPACA_EXECUTION_FEED` | `iex` | Real-time, non-consolidated IEX quote used for paper guards |
| `SEC_USER_AGENT` | Contact name + monitored email | Required identification for SEC EDGAR fair access |
| `AUTOMATION_POLL_SECONDS` | `5` | Worker interval for paper reconciliation and guarded approved-intent processing |
| `AUTOMATION_QUOTE_MAX_AGE_SECONDS` | `60` | Default maximum execution-quote age |
| `AUTOMATION_MAX_PRICE_DEVIATION_PCT` | `2.0` | Default maximum move away from the reviewed plan |
| `ALLOW_LIVE_TRADING` | `false` | Must remain false; true blocks this paper-only release |

Changing either feed to `sip` would require an entitlement this project does not provide or claim. Use the defaults for the free local path.

## Understand the two market feeds

### Scanner: delayed consolidated SIP

`ALPACA_SCANNER_FEED=delayed_sip` provides broad consolidated US-market context with the free-plan delay preserved in stored provenance. Use it to refresh scanner price, gap, spread, VWAP, volume, and previous-close context. Do not use it as proof that an entry price is still available.

### Paper guard: real-time IEX

`ALPACA_EXECUTION_FEED=iex` provides fresher quotes from the IEX venue only. It is not consolidated, not NBBO, and does not represent all US exchange liquidity. The automation guard records its timestamp/feed and checks age and price deviation before a paper submission.

Selecting `sip` does not prove that an Alpaca account owns paid real-time SIP. In this free-source release the Operations status reports that entitlement as unverified, disables SIP sync, and blocks SIP execution. Keep scanner research on `delayed_sip` and paper execution checks on `iex`.

Market/news/filing integration uses manually triggered REST synchronization. The separate paper worker does not maintain a market/news WebSocket connection or refresh scanner/news data.

## Paper worker behavior

Docker Compose starts `trading_paper_automation_worker` with the API. Every `AUTOMATION_POLL_SECONDS` it runs one guarded paper cycle:

1. If the safe paper broker is configured, reconcile active or uncertain intents by deterministic client order ID.
2. Stop before new submissions unless automation is enabled, **Submit already-approved paper orders during a run** is enabled, and the kill switch is released.
3. Consider only intents that already passed manual approval, then run the same plan, risk, broker, clock, position/order, IEX quote-age, spread, VWAP, price-drift, notional, and daily-count preflight.
4. Acquire the shared execution gate, re-read the kill switch and limits, verify that acknowledged warnings have not changed, recheck quote freshness and the daily reservation, then look up the deterministic client ID immediately before any broker write.
5. Submit at most one deterministic protected order per intent. An ambiguous write becomes `submission_unknown`; it is looked up and never blindly submitted again.
6. Continue reconciling a filled bracket/OTO parent until an active stop is confirmed and an exit leg fills. Missing or rejected protection becomes `protection_failed` and engages the global kill switch.

The disabled defaults therefore still permit safety reconciliation but cannot create a new paper order. You can inspect worker activity with:

```bash
docker compose logs -f worker
```

## Operations workflow

After the stack starts, open http://localhost:3000 and select **Operations**.

1. Check the connection cards. Market/news and broker should show configured once Alpaca paper keys are present; SEC should show configured once `SEC_USER_AGENT` is present.
2. Sync market data for scanner/watchlist symbols. When no symbols are entered, the API uses watched symbols first and then active scanner symbols, capped to a small local batch.
3. Sync external events. Alpaca News and SEC EDGAR are run independently, and one provider can fail without turning the other event source into verified data.
4. Review the imported headline/filing, open its source URL, choose the catalyst type and quality, and promote it manually. Unpromoted events do not receive catalyst score.
5. Refresh the paper broker to inspect account status, market clock, positions, and recent orders through the provider-neutral broker contract.
6. Create an execution intent only from a valid saved trade plan. Review its captured risk snapshot, approve it manually, and acknowledge any allowed warnings. A fresh IEX quote is fetched during submission preflight.
7. Automation remains blocked until **Enable paper automation runs** is saved and the kill switch is deliberately released with the confirmation shown in Operations. Releasing the switch does not bypass manual approval or other checks.
8. Submit one approved intent deliberately, or separately enable **Submit already-approved paper orders during a run**. The worker will consider it on a later poll; **Run paper automation** triggers the same cycle immediately. Every path executes the same fresh preflight and reconciles first.
9. Inspect the returned blockers and intent status. Each transition is persisted in the automation audit history. If Alpaca's response is uncertain, do not create another intent or repeat the request; leave reconciliation to the persisted client order ID.

Only limit bracket/OTO paper orders are supported. Market orders, extended-hours orders, live orders, and automatic approval are not available.

## External source behavior

### Alpaca News

The REST adapter requests symbol-linked articles with the same Alpaca credentials, paginates results, and stores source timestamps and request provenance. Free-account availability and freshness can vary; a provider error is surfaced rather than silently replaced with fabricated content.

### SEC EDGAR

The SEC adapter downloads the public ticker map and recent company submissions, filters relevant forms, and paces per-company requests. Filings such as 8-K/6-K, registration/prospectus forms, EFFECT notices, periodic reports, and ownership reports are stored as external review events. A filing form alone is not a positive catalyst.

## First sample scanner CSV

```csv
ticker,price,gap_pct,rel_volume,float_m,market_cap_m,spread_pct,catalyst_type,above_vwap,news_headline
SINT,2.35,42,18.4,8.2,21,0.9,FDA,true,Positive Phase 2 clinical data announced
ABVC,3.12,27,9.1,12.5,38,1.2,Contract,true,Company announces new distribution agreement
XYZ,1.84,16,4.3,55.0,120,2.4,Vague PR,false,Company provides strategic update
```

The Scanner accepts UTF-8 CSV uploads with these required columns. Optional boolean columns `clean_daily_chart_room`, `holding_key_level`, and `no_dilution_red_flag` make their scoring evidence explicit. Use `true` or `false`; unverified values should not be treated as positive evidence.

## Frontend/API proxy

During local frontend development, Next.js proxies `/api/*` to `API_INTERNAL_BASE_URL` (default `http://localhost:8000`). Docker Compose sets the internal destination to `http://api:8000`.

## Verification

Frontend:

```bash
cd apps/web
npm run typecheck
npm run lint
npm run build
```

Backend:

```bash
cd apps/api
../../.venv/bin/python -m pytest -q
```

## Troubleshooting

- **Operations says Alpaca is not configured:** confirm both paper key fields are set in `.env`, then recreate the stack.
- **SEC sync is skipped:** set `SEC_USER_AGENT` to a contactable name/application and email.
- **SIP entitlement error:** restore `ALPACA_SCANNER_FEED=delayed_sip` and `ALPACA_EXECUTION_FEED=iex`; this project does not include paid real-time SIP.
- **Broker is blocked as unsafe:** restore the exact paper URL and `ALLOW_LIVE_TRADING=false`.
- **No symbols to sync:** add scanner rows, add watchlist items, or enter symbols in Operations.
- **Paper intent stays blocked:** inspect the returned blocker list; enabling automation or releasing the kill switch never overrides plan, account, clock, quote, daily-risk, notional, or approval failures.
