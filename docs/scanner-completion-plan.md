# Scanner Completion Plan

This document defines the path from the current persistent/demo scanner to a complete daily scanner. It is intentionally scanner-first: additional broker automation should wait until the discovery, ranking, freshness, and historical-review workflow is useful and trustworthy.

Canonical domain language lives in [`../CONTEXT.md`](../CONTEXT.md), and durable design decisions
live in [`adr/`](adr/).

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

## First milestone boundary

The first scanner-session milestone is manual-first:

- One explicit **Run scanner** action starts a run; scheduling is deferred.
- Only one scanner run may be active globally. A repeated request returns the active run and progress.
- A completed run requires broad Market-Movement Discovery from accessible movers/activity
  screeners or delayed consolidated bars. News, filings, manual entry, and CSV supplement discovery.
- Every attempt is immutable and ends as completed, partial, failed, or cancelled.
- Only completed sessions may replace the Actionable Current Session, and promotion is atomic.
- Paper-execution feature development remains frozen except for safety defects.

## Current observations

- `scanner_symbols` contains one unique row per ticker rather than one observation per market session, so old symbols persist across days.
- Market-data synchronization refreshes existing scanner/watchlist symbols but does not discover new candidates.
- Relative volume, float, market cap, chart room, key-level status, and the current dilution-clearance flag are imported or manually assigned rather than represented as sourced Candidate Evidence and a Capital Structure Review.
- Operational mode no longer auto-seeds demo data; explicitly selected demo mode tags its sample rows so operational scanner queries can exclude them.
- Market, news, and SEC synchronization is manually triggered; there is no scanner scheduler.
- There is no immutable scanner-session or replay model. Database changes are now managed by Alembic.
- The Alpaca, SEC, and paper-broker integrations require local configuration before the current integration slice can be exercised. A read-only Alpaca capability probe records actual endpoint and feed access once paper credentials are present.
- Frontend verification and the backend suite pass; the host backend environment now uses Python 3.14.7.
- Guarded paper-execution infrastructure is further developed than daily scanner discovery. Scanner work should take priority over additional execution features.

## Data-source constraints

- Alpaca provides [most-active stocks](https://docs.alpaca.markets/us/v1.1/reference/mostactives-1) and [top market movers](https://docs.alpaca.markets/us/reference/movers-1), but these screeners use real-time SIP data. The movers endpoint resets at market open and shows the prior market day's movers before then, so it cannot be the only source for premarket discovery.
- Alpaca's free real-time stock feed is IEX-only. Consolidated real-time SIP requires the relevant entitlement; delayed historical SIP is available subject to its documented delay. See the [Alpaca market-data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq).
- The [Alpaca Assets API](https://docs.alpaca.markets/us/reference/get-v2-assets-1) can provide the active/tradable universe and exchange metadata, but it does not provide the complete dated fundamentals required for float and market-cap scoring.
- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) provide filing history and XBRL facts. Shares outstanding and public-float facts can be stale, absent, or inconsistent, so derived values must retain their source and reporting date.
- Values from different feeds must not be mixed without labeling. In particular, IEX-only real-time volume is not directly comparable to consolidated SIP volume.

## Phase 0: Stabilize the foundation

**Status: Implemented.** Python 3.14.7 is installed for host verification, the backend suite
runs in a recreated Python 3.14 virtual environment, Alembic owns schema changes, operational
mode does not auto-seed sample candidates, and Operations can persist read-only Alpaca
endpoint/feed capability checks. Actual account results still require the operator's local paper
credentials and an explicit probe.

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
Security
  └── effective-dated Listing(s)

ScannerSession
  ├── DiscoveryHit(s)
  │     └── admitted, rejected, or unresolved
  └── Candidate(s)
        ├── Candidate Evidence
        ├── Catalyst Review(s)
        ├── Capital Structure Review(s)
        └── Score Evaluation(s)
```

Security is the stable identity; ticker and exchange belong to an effective-dated Listing. Every
provider result is retained as a Discovery Hit, but only hits admitted to the target instrument
universe become Candidates. Multiple hits may provide discovery reasons for one Candidate.

Each session should record:

- Trading Date and Market Phase: premarket, regular, after-hours, or closed.
- Start, terminal, and promotion timestamps.
- Lifecycle status: running, completed, partial, failed, or cancelled.
- Discovery method, data feed, consolidation scope, and expected delay.
- Scanner Policy and Scoring Model versions with their resolved settings.
- Discovery Hits, admission outcomes, and rejection or unresolved reasons.
- Candidate Evidence with source, event time, observation time, Data Tier, and Freshness.
- Original and later append-only Score Evaluations with the exact evidence each used.

A Partial Session has a usable, internally consistent Candidate set but failed to complete work that
its Scanner Policy declared required. Ordinary Unknown Evidence or low Evidence Coverage does not
make a session partial. Running progress is visible in Operations, but no running, partial, failed,
or cancelled data may leak into the Actionable Current Session.

Preserve pre-session operational/manual rows as a non-actionable Legacy Import. Do not invent a
Trading Date, Market Phase, or provenance for data the old schema did not record; exclude demo rows
unless they are deliberately requested.

Update the dashboard with a current-session heading, last-refreshed time, market phase/feed badges, a session selector, and prominent stale/incomplete/failed states.

### Exit criteria

- Reopening the application does not show a prior session as today's scanner.
- Previous sessions remain queryable without mutation.
- Every displayed candidate belongs to an explicit session.
- Failed, partial, and cancelled attempts remain inspectable without replacing the last completed session.
- Ticker changes and ticker reuse do not alter historical Security identity.
- Current-session promotion is atomic.

## Phase 2: Implement provider-driven candidate discovery

### Work

- Add a provider-neutral discovery contract.
- Fetch and cache the active U.S.-listed instrument universe and resolve its Security and Listing identities.
- Combine eligible most-active and top-gainer results when the configured account can access them.
- Use delayed consolidated bars as the required Market-Movement Discovery fallback when those
  screeners are unavailable.
- Add symbols associated with fresh news and SEC filings.
- Reject unsupported exchanges, inactive or delisted Listings, invalid prices, and instruments outside the Target Instrument Universe where they can be identified reliably. Preserve temporary halt and broker-tradability evidence for later review and Execution Check.
- Retain every provider result as a Discovery Hit and deduplicate admitted Candidates while
  preserving every discovery reason.
- Retain manual and CSV import as explicit fallback discovery sources.
- Run a capability spike against the real Alpaca account before committing to a premarket implementation.
- If real-time SIP screeners are unavailable, use delayed consolidated bars for the research-mode candidate pipeline. Treat a true premarket real-time scanner as a future paid-data path.

### Exit criteria

- A manual **Run scanner** action creates a new session with newly discovered candidates and no CSV requirement.
- Each candidate shows why and when it was discovered.
- Source failures are visible and do not silently reuse old candidates as current.
- A news- or filing-only result cannot be labelled a completed momentum scan.

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

## Phase 4: Complete Catalyst and Capital Structure Reviews

### Work

- Fetch Alpaca news and SEC filings for all discovered candidates.
- Deduplicate and link events to the relevant scanner session.
- Suggest event and filing types while requiring a human Catalyst Review before awarding positive Catalyst points.
- Detect offering, shelf, resale, warrant, convertible, reverse-split, and related evidence for a lightweight human Capital Structure Review.
- Require source links and a short rationale for completed reviews; reason codes remain optional aids.
- Never interpret a missing filing or missing fact as verified absence of capital-structure risk.
- Display source links, publication/reporting age, review state, and promotion history.

### Exit criteria

- Every Candidate in the Focus View has a human-reviewed Fresh Catalyst.
- Every eligible Candidate has a current Capital Structure Review whose outcome is no identified concern or warning.
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
- The dashboard visibly distinguishes running, completed, partial, cancelled, failed, and stale conditions.
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

Phase 0 is complete. The next sprint should be limited to the agreed scanner-session backbone:

1. Add stable Security and effective-dated Listing identity plus Scanner Session, Discovery Hit,
   Candidate, Candidate Evidence, and Score Evaluation persistence.
2. Migrate existing non-demo scanner rows into a non-actionable Legacy Import.
3. Add one globally serialized manual **Run scanner** API and dashboard action.
4. Implement Market-Movement Discovery with capability-aware screeners and delayed consolidated-bar
   fallback; retain news, filings, manual entry, and CSV as supplementary sources.
5. Preserve Scoring Model v1 weights while adding explicit unknown/stale evidence, Evidence Coverage,
   neutral Score Tiers, and separate Research Eligibility.
6. Display run progress, lifecycle, source, Data Tier, delay, Freshness, admission outcomes, and
   review state. Promote only completed sessions atomically.

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
