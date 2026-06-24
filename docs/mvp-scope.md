# MVP Scope

## MVP objective

Build a zero-cost local tool that proves the full trading workflow before paying for hosting, market data, news feeds, or broker integration.

## Included in MVP

### 1. Scanner table

Columns:

- Score
- Ticker
- Price
- Gap %
- Relative volume
- Float
- Market cap
- Spread %
- Catalyst type
- VWAP status
- News headline
- Watch / ignore status

### 2. Catalyst input

The MVP can use manual or CSV-based catalyst data.

Fields:

- Ticker
- Published time
- Source
- Headline
- Catalyst type
- Quality score

### 3. Scoring model

Each ticker receives a score from 0 to 100 based on predefined criteria.

### 4. Watchlist

User can save promising tickers to a daily watchlist.

### 5. Trade planner

Fields:

- Account size
- Max risk per trade
- Entry price
- Stop price
- Target price
- Position size
- Max loss
- R multiple

### 6. Journal

Fields:

- Date
- Ticker
- Setup
- Catalyst type
- Entry
- Stop
- Exit
- Shares
- P&L
- R multiple
- Notes
- Mistake tags

### 7. Basic analytics

Initial metrics:

- Total trades
- Win rate
- Average win
- Average loss
- Net P&L
- Average R
- Best catalyst type
- Most common mistake

## Excluded from MVP

- Live broker execution
- Hotkeys
- Auto-trading
- Multi-user accounts
- Public SaaS features
- Paid news integrations
- Paid market data integrations
- Mobile app
- AI trade prediction

## MVP success criteria

The MVP is successful if it helps create cleaner daily watchlists and more disciplined trade planning using manual, delayed, or historical data.
