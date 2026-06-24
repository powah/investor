# Scoring Model

## Purpose

The scoring model ranks small-cap catalyst-driven stocks so the user can focus on the best candidates and ignore weak/noisy movers.

The score should not be treated as a buy signal. It is a watchlist prioritization tool.

## Initial 100-point model

| Factor | Points |
|---|---:|
| Fresh strong catalyst | 20 |
| Gap > 10% | 10 |
| Relative volume > 5x | 15 |
| Float under 20M | 10 |
| Clean daily chart room | 10 |
| Above VWAP | 10 |
| Tight spread / good liquidity | 10 |
| Holding key level | 10 |
| No obvious dilution red flag | 5 |
| Total | 100 |

## Classification

| Score | Label | Meaning |
|---:|---|---|
| 80-100 | A+ watch | Strong candidate for close monitoring |
| 65-79 | Watch | Possible setup, needs confirmation |
| 50-64 | Weak | Usually avoid unless conditions improve |
| Under 50 | Ignore | Not worth attention |

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
Label: A+ watch
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
