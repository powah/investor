# Small-Cap Catalyst Research

This context describes the language used to discover, evaluate, and review small-cap catalyst momentum candidates before any trading decision.

## Language

**Delayed Research Scanner**:
A decision-support scanner whose market evidence may be delayed but is consolidated, provenance-labelled, and suitable for candidate research rather than execution-price validation.
_Avoid_: Real-time scanner, execution scanner, signal scanner

**Scanner Session**:
A single immutable run attempt of the Delayed Research Scanner, scoped to a Trading Date and Market Phase. Failed, partial, and cancelled attempts remain distinct Scanner Sessions; the Actionable Current Session is derived from completed qualifying attempts.
_Avoid_: Scanner list, current symbols

**Legacy Import**:
Non-actionable scanner data preserved from the pre-session mutable model without inventing missing provenance, Trading Date, or Market Phase. It remains available for reference but can never become the Actionable Current Session.
_Avoid_: Historical Scanner Session, current scanner

**Partial Session**:
A terminal Scanner Session that produced a usable, internally consistent Candidate set but did not complete at least one source or stage required by its Scanner Policy. Ordinary Unknown Evidence or low Evidence Coverage does not make a session partial.
_Avoid_: Incomplete Candidate, low coverage, failed session

**Actionable Current Session**:
The latest completed Scanner Session that satisfies the applicable currentness rules. A newer partial, failed, or cancelled attempt remains visible but cannot replace it; when no completed session qualifies, there is no actionable current session.
_Avoid_: Latest attempt, latest session

**Market Phase**:
The fixed exchange period targeted by a Scanner Session: premarket, regular, after-hours, or closed. It is assigned when the run starts from the official U.S. exchange calendar in America/New_York time and never changes if the run crosses a phase boundary.
_Avoid_: Local time period, current phase

**Trading Date**:
The U.S. exchange-calendar date to which a Scanner Session and its fixed Market Phase belong.
_Avoid_: Operator date, UTC date

**Catalyst Trading Date**:
The first Trading Date on which the regular market can react to a Catalyst: the publication date for premarket or regular-hours publication, and the next Trading Date for publication after the regular close.
_Avoid_: Publication date, calendar date

**Fresh Catalyst**:
A reviewed Catalyst within its Scanner Policy reaction window, initially its Catalyst Trading Date and the next two Trading Dates. Weekends and exchange holidays do not consume the window.
_Avoid_: Recent headline, 72-hour catalyst

**Catalyst Review**:
A required append-only human assessment that promotes an external event into a classified Catalyst with a quality judgment, rationale, reviewer, and review time. Automated suggestions remain unverified and cannot award positive Catalyst points; a later review supersedes rather than edits an earlier review.
_Avoid_: Headline sentiment, automatic catalyst

**Capital Structure Review**:
An append-only human assessment of available offering, shelf, resale, warrant, convertible, reverse-split, and related evidence, with outcomes of pending, no identified concern, warning, or disqualifying; completed reviews require source links, reviewer, review time, and a short rationale. It initially remains current for its review Trading Date and the next two Trading Dates, but newer relevant evidence or time expiry returns the gate to pending without deleting the prior review.
_Avoid_: Dilution Review, filing-form verdict, automatic dilution clearance

**Capital Structure Reason**:
A factual optional aid for a Capital Structure Review: primary offering, at-the-market program, equity line, shelf capacity, resale registration, warrant overhang, convertible overhang, reverse split, or other material capital-structure risk. Severity is recorded separately.
_Avoid_: Verdict, automatic Disqualifier

**Discovery Hit**:
A source-labelled occurrence of a security during scanner discovery, retained whether it is admitted, rejected, or unresolved. Multiple Discovery Hits may contribute distinct discovery reasons for one Candidate.
_Avoid_: Candidate, scanner result

**Market-Movement Discovery**:
Broad-universe discovery based on market movement or activity. A completed scanner run requires it, using accessible mover/activity screeners or delayed consolidated market bars; news, filings, manual entry, and CSV are supplementary or explicit fallback sources.
_Avoid_: News-only scanner, filing-only scanner

**Security**:
The stable identity of an issuer's admitted equity instrument across ticker or exchange changes. Historical records reference the Security rather than treating ticker text as permanent identity.
_Avoid_: Ticker, company name

**Listing**:
An effective-dated ticker and exchange identity for a Security. Discovery Hits and Candidates retain the Listing that applied when they were observed.
_Avoid_: Security, permanent ticker

**Candidate Admission**:
The determination that a Discovery Hit represents an instrument belonging to the scanner's target universe. Rejected and unresolved Discovery Hits remain recorded but do not become Candidates.
_Avoid_: Research eligibility, score threshold

**Target Instrument Universe**:
Common stocks and American Depositary Shares listed on Nasdaq, the New York Stock Exchange, or NYSE American. It excludes funds, preferred shares, units, warrants, rights, and over-the-counter securities.
_Avoid_: All U.S. tickers, all equities

**Scanner Policy**:
The versioned admission, eligibility, and evaluation rules applied by a Scanner Session. A session permanently retains the policy version and resolved settings it used.
_Avoid_: Current settings, global rules

**Small-Cap**:
A Candidate whose verified market capitalization does not exceed the Scanner Policy ceiling, initially $2 billion and inclusive of micro-cap companies. A Candidate with unknown or stale market capitalization has unverified Research Eligibility.
_Avoid_: Low-priced stock, low-float stock

**Price Eligibility**:
The determination that a Candidate's session price meets the Scanner Policy minimum, initially $1 with no maximum. Unknown or stale price evidence makes Research Eligibility unverified.
_Avoid_: Small-Cap, affordability

**American Depositary Share**:
A U.S.-exchange-traded equity unit representing an interest in a foreign issuer's deposited ordinary shares. Its underlying-share ratio and foreign-issuer status remain explicit Candidate Evidence.
_Avoid_: ADR, U.S. common stock

**Candidate**:
A security admitted from one or more Discovery Hits into a Scanner Session for research and possible watchlist promotion; inclusion is not a recommendation to trade.
_Avoid_: Pick, signal, trade

**Candidate Evidence**:
The immutable, source- and time-labelled facts available for a Candidate during a Scanner Session. Later corrections or newer facts are appended and do not replace the evidence originally used.
_Avoid_: Current data, latest values

**Data Tier**:
The declared timing and market-coverage contract of Candidate Evidence, such as delayed consolidated SIP or real-time single-venue data. Data Tier is independent from freshness.
_Avoid_: Freshness, source name

**Freshness**:
Whether Candidate Evidence remains within the evidence-type-specific delay and maximum-age limits declared by its Data Tier and Scanner Policy. Delayed evidence may be fresh within its tier; different evidence types may expire at different times.
_Avoid_: Real-time, delay

**Stale Evidence**:
Candidate Evidence retained after its type-specific Freshness limit has expired. It remains part of the historical record but cannot support a current positive score or eligibility conclusion.
_Avoid_: Deleted evidence, Verified Negative Evidence

**Unknown Evidence**:
Candidate Evidence that has not been established well enough to support either a positive or negative conclusion. It earns no score points but does not assert that the factor failed or that a risk was found.
_Avoid_: False, zero, clear, failed

**Verified Negative Evidence**:
Candidate Evidence that affirmatively shows a scoring condition is not satisfied or that a reviewed risk is present. It is not interchangeable with Unknown Evidence.
_Avoid_: Missing data, unavailable data

**Score Evaluation**:
A versioned score and explanation calculated from a fixed set of Candidate Evidence. Human research may append new reviews and evaluations after session completion, but the original evaluation remains attached to its Scanner Session; later recalculation never replaces it.
_Avoid_: Current score, ticker score

**Scoring Model**:
The versioned factors, weights, and evaluation rules used to produce a Score Evaluation. Version 1 retains the project's existing 100-point weights while adopting explicit Unknown Evidence, Evidence Coverage, and neutral Score Tiers.
_Avoid_: Scanner Policy, current formula

**Score Tier**:
A neutral band derived from a Score Evaluation: Tier A for 80–100, Tier B for 65–79, Tier C for 50–64, and Tier D for 0–49. It conveys ranking strength but no workflow action.
_Avoid_: A+ watch, Watch, Weak, Ignore

**Evidence Coverage**:
The proportion of a scoring model's possible points for which a Score Evaluation had known evidence. It describes evidential completeness, does not rescale the score, and is not a Research Eligibility gate.
_Avoid_: Confidence score, normalized score

**Research Eligibility**:
A non-compensating determination, separate from ranking score and Execution Check, of whether a Candidate is eligible, ineligible, or unverified for the actionable research queue. It requires a human-reviewed Fresh Catalyst and current Capital Structure Review; temporary halts, market closure, and broker-specific constraints do not change it.
_Avoid_: Score threshold, trade approval

**Focus View**:
The default score-filtered presentation of eligible Candidates, initially limited to Tier A and Tier B. It prioritizes attention without changing Research Eligibility or historical Score Evaluations.
_Avoid_: Eligibility gate, watchlist

**Disqualifier**:
Verified Candidate Evidence that makes a Candidate ineligible for actionable research regardless of its ranking score.
_Avoid_: Point deduction, warning

**Execution Check**:
A fresh, paper-broker-facing validation performed against a planned order immediately before submission. Temporary halts, market clock, broker tradability, and current order constraints belong here rather than in Research Eligibility.
_Avoid_: Scanner refresh, trade signal
