# Scanner Completion Plan

This document defines the path from the current persistent/demo scanner to a complete daily scanner. It is intentionally scanner-first: additional broker automation should wait until the discovery, ranking, freshness, and historical-review workflow is useful and trustworthy.

## Target state

A complete scanner should:

- Create a new, date-scoped session for each trading day and market phase.
- Discover current candidates without requiring a CSV upload.
- Calculate or source every ranking input with provenance and an `as_of` timestamp.
- Distinguish fresh, delayed, stale, unavailable, and manually reviewed evidence.
- Explain every score and avoid awarding points for unknown evidence.
- Preserve prior sessions for review and replay without presenting them as current.
- Refresh on a documented schedule and visibly fail closed when a source is unavailable.
- Support the scanner-to-watchlist-to-planner workflow without implying a buy or sell signal.

The first target should be a complete **delayed research scanner**. A consolidated real-time or premarket execution scanner is a separate data-entitlement decision and should not be implied by the free-data implementation.

## Current observations

- `scanner_symbols` contains one unique row per ticker rather than one observation per market session, so old symbols persist across days.
- Market-data synchronization refreshes existing scanner/watchlist symbols but does not discover new candidates.
- Relative volume, float, market cap, chart room, key-level status, and dilution clearance are currently imported or manually assigned rather than fully calculated.
- Demo data is seeded on application startup and is not clearly separated from operational scanner data.
- Market, news, and SEC synchronization is manually triggered; there is no scanner scheduler.
- There is no immutable scanner-session or replay model and no database migration framework.
- The Alpaca, SEC, and paper-broker integrations require local configuration before the current integration slice can be exercised.
- The frontend typecheck and lint pass. The existing host virtual environment is Python 3.9 even though the project runtime is Python 3.14, so backend verification must be normalized before relying on test results.
- Guarded paper-execution infrastructure is further developed than daily scanner discovery. Scanner work should take priority over additional execution features.

## Data-source constraints

- Alpaca provides [most-active stocks](https://docs.alpaca.markets/us/v1.1/reference/mostactives-1) and [top market movers](https://docs.alpaca.markets/us/reference/movers-1), but these screeners use real-time SIP data. The movers endpoint resets at market open and shows the prior market day's movers before then, so it cannot be the only source for premarket discovery.
- Alpaca's free real-time stock feed is IEX-only. Consolidated real-time SIP requires the relevant entitlement; delayed historical SIP is available subject to its documented delay. See the [Alpaca market-data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq).
- The [Alpaca Assets API](https://docs.alpaca.markets/us/reference/get-v2-assets-1) can provide the active/tradable universe and exchange metadata, but it does not provide the complete dated fundamentals required for float and market-cap scoring.
- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) provide filing history and XBRL facts. Shares outstanding and public-float facts can be stale, absent, or inconsistent, so derived values must retain their source and reporting date.
- Values from different feeds must not be mixed without labeling. In particular, IEX-only real-time volume is not directly comparable to consolidated SIP volume.

## Phase 0: Stabilize the foundation

### Work

- Recreate the local Python 3.14 virtual environment and make the backend suite green.
- Add a database migration framework and a documented migration workflow.
- Separate demo mode from operational mode.
- Do not automatically present seeded symbols as ordinary current-session results.
- Configure Alpaca paper credentials and a contactable `SEC_USER_AGENT` locally; never commit credentials.
- Add a provider capability check that records which Alpaca endpoints and feeds the configured account can access.

### Exit criteria

- Frontend and backend verification passes in supported runtimes.
- Database schema changes are repeatable and upgradeable.
- An operational scanner is empty until a real session or explicit import runs.
- Provider status reports actual tested capability rather than configuration alone.

## Phase 1: Add immutable scanner sessions

### Work

Introduce a date-scoped model, conceptually:

```text
ScannerSession
  └── ScannerCandidate
        ├── Market observations
        ├── Fundamental observations
        ├── Catalyst evidence
        └── Score evaluation
```

Each session should record:

- Trading date and market phase: premarket, regular, or after-hours.
- Start, completion, and failure timestamps.
- Session status and error summary.
- Discovery method, data feed, consolidation scope, and expected delay.
- Candidate observations with source and `as_of` time.
- Score version and the exact evidence used.

Update the dashboard with a current-session heading, last-refreshed time, market phase/feed badges, a session selector, and prominent stale/incomplete/failed states.

### Exit criteria

- Reopening the application does not show a prior session as today's scanner.
- Previous sessions remain queryable without mutation.
- Every displayed candidate belongs to an explicit session.

## Phase 2: Implement automatic candidate discovery

### Work

- Add a provider-neutral discovery contract.
- Fetch and cache the active, tradable US-equity universe.
- Combine eligible most-active and top-gainer results when the configured account can access them.
- Add symbols associated with fresh news and SEC filings.
- Filter unsupported exchanges, non-tradable assets, invalid prices, and non-target securities where they can be identified reliably.
- Deduplicate candidates while preserving every discovery reason.
- Retain manual and CSV import as explicit fallback discovery sources.
- Run a capability spike against the real Alpaca account before committing to a premarket implementation.
- If real-time SIP screeners are unavailable, use delayed consolidated bars for the research-mode candidate pipeline. Treat a true premarket real-time scanner as a future paid-data path.

### Exit criteria

- A manual **Run scanner** action creates a new session with newly discovered candidates and no CSV requirement.
- Each candidate shows why and when it was discovered.
- Source failures are visible and do not silently reuse old candidates as current.

## Phase 3: Calculate scanner metrics

### Work

Calculate or source:

- Current price and previous close.
- Gap percentage.
- Current session volume.
- Relative volume compared with the same elapsed time across prior sessions.
- Bid/ask spread.
- Session VWAP and distance from VWAP.
- Daily chart resistance and available chart room.
- Key intraday, premarket, and prior-day levels.
- Halt and tradability status.

Apply the following fundamental-data policy:

- Estimate market cap only from dated shares outstanding and a clearly identified price observation.
- Store float only when it has a source and reporting date.
- Represent missing values as `unknown`, never as zero.
- Do not award points for unknown or stale evidence.
- Keep manual overrides separate from provider observations and retain an audit trail.

### Exit criteria

- Every scoring input has a value or explicit unknown state, source, observation time, and explanation.
- Relative volume uses a documented, reproducible formula and a consistent market-data feed.
- Recomputing a score from stored evidence produces the same result.

## Phase 4: Complete catalyst and dilution review

### Work

- Fetch Alpaca news and SEC filings for all discovered candidates.
- Deduplicate and link events to the relevant scanner session.
- Classify clear event and filing types while retaining human review for catalyst quality.
- Detect offering-related filings, shelf registrations, reverse splits, and other dilution warnings.
- Never interpret a missing filing or missing fact as verified absence of dilution risk.
- Display source links, publication/reporting age, review state, and promotion history.

### Exit criteria

- Every high-ranked candidate has a reviewed fresh catalyst or is clearly marked as lacking one.
- Dilution clearance is explicit, dated, and evidence-backed.
- Scoring never treats an unreviewed external headline as a verified strong catalyst.

## Phase 5: Schedule and operate the scanner

### Work

- Add a scanner worker separate from paper-order automation.
- Refresh the asset universe daily.
- Run discovery at configured market-phase times.
- Refresh candidate evidence at a cadence appropriate to the configured feed delay.
- Use `America/New_York` for exchange scheduling and display the operator's local time secondarily.
- Rate-limit requests and retry safe reads with bounded backoff.
- Prevent overlapping session runs.
- Expose last successful run, current run, failures, record counts, expected delay, and source health.
- Retain manual rerun controls.

### Exit criteria

- A new scanner session is created automatically on each trading day.
- The dashboard visibly distinguishes running, complete, partial, stale, and failed sessions.
- Feed failures do not overwrite the last good immutable session or label it as current.

## Phase 6: Add replay and validate the model

### Work

- Import and preserve historical bars and scanner observations.
- Replay a prior session using only information available at that historical moment.
- Version scoring rules so historical results remain reproducible.
- Compare score bands, catalyst types, and individual factors with journal outcomes.
- Tune scoring only after enough reviewed scanner and journal data exists.
- Resume longer-running paper-execution evaluation after the scanner workflow is stable.

### Exit criteria

- A prior trading day can be replayed without future-data leakage.
- Score changes can be compared across versions.
- Scanner usefulness can be evaluated from collected evidence rather than anecdote.

## Immediate implementation sprint

The next sprint should be limited to:

1. Normalize the Python 3.14 development and test environment.
2. Introduce database migrations.
3. Add `ScannerSession` and session-candidate persistence.
4. Isolate automatic demo data from operational mode.
5. Add an Alpaca screener/feed entitlement probe.
6. Add the first manual **Discover current candidates** API and dashboard action.
7. Display session, source, delay, and freshness state in the scanner UI.

This establishes the backbone required for subsequent metric calculation, catalyst enrichment, scheduling, and replay without another scanner data-model rewrite.

## Complete-scanner definition of done

The scanner is complete for its declared data tier when:

- It automatically creates a fresh session on each configured trading day.
- It discovers candidates without demo data or CSV input.
- No previous-day candidate is silently presented as current.
- Every displayed metric includes source, `as_of` time, and freshness state.
- Unknown or stale evidence cannot earn score points.
- Candidate scores are reproducible from immutable stored evidence.
- News and filing evidence is linked, deduplicated, and reviewable.
- Manual fallback and rerun controls remain available.
- Partial and failed runs are obvious in both the API and dashboard.
- Historical sessions can be selected and replayed without future-data leakage.
- Automated tests cover discovery, session isolation, score reproducibility, source failures, and stale-data behavior.

