# Risk Rules

## Purpose

The risk engine is the most important part of the tool. It should prevent emotional, oversized, and low-quality trades.

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

## Required warnings

The tool should warn or block trade planning when:

- Stop price is missing
- Risk per share is too large
- Position size exceeds user limit
- Daily max loss has been hit
- Spread is too wide
- Stock has no fresh catalyst
- Score is below minimum threshold
- Stock is below VWAP when strategy requires VWAP confirmation
- User has exceeded max trades per day
- User has hit max consecutive losses

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

## Hard rules for the MVP

- Every trade plan must include a stop.
- Position size must be calculated before entry.
- Daily max loss must be visible.
- Journal should record whether the user followed the plan.

## Future features

- Broker sync
- Automatic P&L import
- Screenshot capture
- Trade replay
- Rule violation analytics
