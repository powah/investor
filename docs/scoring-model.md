# Scoring Model

## Purpose

The scoring model ranks small-cap catalyst-driven stocks so the user can focus on the best candidates and ignore weak/noisy movers.

The score should not be treated as a buy signal. It is a watchlist prioritization tool.

## Scoring Model v1

The first scanner-session milestone preserves the existing 100-point weights. It changes how
evidence is represented and evaluated, not the strategy weights themselves.

| Factor | Points |
|---|---:|
| Fresh human-reviewed catalyst | 20 |
| Gap > 10% | 10 |
| Relative volume > 5x | 15 |
| Float under 20M | 10 |
| Clean daily chart room | 10 |
| Above VWAP | 10 |
| Tight spread / good liquidity | 10 |
| Holding key level | 10 |
| No identified capital-structure concern | 5 |
| Total | 100 |

## Evidence rules

- Every evaluation references the exact immutable evidence it used and records its Scoring Model version.
- Unknown or stale evidence earns zero points but is not represented as a verified negative value.
- Scores remain absolute and are never normalized against only the factors that were known.
- Evidence Coverage reports the proportion of possible points for which the evaluation had known evidence.
- A later review or corrected observation creates a new evaluation; it never replaces the original.
- Positive catalyst points require an explicit human Catalyst Review.
- Catalyst freshness is measured by market-reaction Trading Dates: the assigned Catalyst Trading Date and the next two Trading Dates.
- The five-point capital-structure factor requires a current `no_identified_concern` review; pending, warning, or disqualifying outcomes earn zero for that factor.

## Score tiers

| Score | Label | Meaning |
|---:|---|---|
| 80-100 | Tier A | Highest ranking band |
| 65-79 | Tier B | Second ranking band |
| 50-64 | Tier C | Third ranking band |
| Under 50 | Tier D | Lowest ranking band |

Tier labels are deliberately neutral. They describe ranking strength, not Research Eligibility or a
workflow action. The default Focus View shows eligible Tier A and Tier B Candidates, while lower
tiers remain available through filters.

## Research Eligibility

Research Eligibility is evaluated independently from score and has three outcomes: eligible,
ineligible, or unverified. A high score cannot compensate for a missing gate or Disqualifier.

The initial policy requires:

- An admitted common stock or American Depositary Share on Nasdaq, NYSE, or NYSE American.
- Verified market capitalization no greater than $2 billion.
- A fresh session price of at least $1.
- A current active listing.
- A human-reviewed Fresh Catalyst.
- A current Capital Structure Review whose completed outcome is `no_identified_concern` or `warning`.

Pending or stale required evidence makes eligibility unverified. A Capital Structure Review warning
does not by itself make a Candidate ineligible. Temporary halts, market closure, and broker-specific
tradability belong to Execution Check rather than Research Eligibility.

## Catalyst quality examples

### Strong catalysts

- FDA / clinical data
- Earnings surprise
- Major contract
- Merger or acquisition
- Guidance raise
- Significant analyst action with volume response
- Major partnership with credible company

### Weak or dangerous catalysts

- Vague press release
- Paid promotion
- Old news recycled
- Generic AI/crypto buzzword headline
- Reverse split without real demand
- Offering or dilution-heavy company
- No fresh news

## Suggested output language

Example:

```text
Score: 82 / 100
Tier: Tier A
Evidence coverage: 90%
Research eligibility: Eligible
Reason: Fresh FDA catalyst, high relative volume, low float, above VWAP.
Risk warning: Spread elevated. Avoid chasing extended candles.
```

## Future improvements

After collecting journal data, tune the model based on actual performance:

- Which catalyst types produce profits?
- Which scores perform best?
- Which factors are misleading?
- Which time windows are strongest?
- Which setups cause losses?
