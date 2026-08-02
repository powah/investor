# Separate research eligibility from ranking score

Research Eligibility is evaluated independently from the 0–100 ranking score and has three outcomes: eligible, ineligible, or unverified. A Candidate with a Disqualifier is ineligible; a Candidate whose gating evidence could not be established is unverified. Both remain visible with their Score Evaluations, but only eligible Candidates enter the actionable research queue. This prevents strong momentum factors from compensating for hard exclusions or missing safety evidence while keeping the underlying ranking evidence inspectable.

Because this is a catalyst-momentum scanner, a human-reviewed Fresh Catalyst is an eligibility requirement. An unreviewed event or the absence of a discovered event leaves the gate unverified, since configured sources cannot prove that no Catalyst exists; a human conclusion that the event is not a genuine Catalyst makes the Candidate ineligible.

The default Focus View initially filters eligible Candidates to scores of 65 or higher, corresponding to Tier A and Tier B. Lower-scoring eligible Candidates remain available outside that view; the filter is a versioned attention preference, not an eligibility rule.

Research Eligibility describes strategic research suitability, not immediate orderability. Permanent listing exclusions such as an inactive or delisted instrument may make it ineligible, while unknown listing status makes it unverified. Temporary halts, market closure, and broker-specific tradability do not change Research Eligibility; they remain prominent evidence and become blockers during Execution Check.

Automated SEC filing-form or keyword detection never creates a capital-structure Disqualifier by itself. It creates a sourced concern and leaves the capital-structure gate unverified until a human Capital Structure Review classifies the evidence. Only a human-confirmed disqualifying result makes Research Eligibility ineligible; warnings remain non-compensating risk information without changing eligibility.

Capital Structure Review outcomes are pending, no identified concern, warning, or disqualifying. The positive wording deliberately avoids “clear” because the review can establish only that no concern was identified in the linked sources, not that capital-structure risk does not exist. Completed reviews record reviewer and review time and eventually become stale.

Any newly discovered relevant filing or corporate event immediately invalidates the current review's applicability and returns the capital-structure gate to pending, even before its normal freshness period expires. The prior review remains immutable and inspectable, but only a superseding human review can restore an eligible result.

The initial Scanner Policy keeps a completed Capital Structure Review current for its review Trading Date and the next two Trading Dates. Every outcome expires, including warning and disqualifying; expiry returns the gate to pending rather than eligible. Later policy versions may change this period without rewriting historical eligibility.

The initial MVP deliberately keeps Capital Structure Review lightweight. A completed review requires source links and a short human rationale, while factual reason codes are optional aids: `primary_offering`, `at_the_market_program`, `equity_line`, `shelf_capacity`, `resale_registration`, `warrant_overhang`, `convertible_overhang`, `reverse_split`, and `other_material_capital_structure_risk`. The MVP does not require formal share-impact, conversion, or remaining-capacity calculations. Those deeper controls are deferred until operating experience shows that their value justifies the review and implementation burden.
