# Tech Stack

## Recommended stack

```text
Frontend: Next.js + React + TypeScript
Styling: TailwindCSS
Charts: TradingView Lightweight Charts
Backend: Python FastAPI
Validation: Pydantic
Database: PostgreSQL
Background jobs: dedicated Python worker
Local runtime: Docker Compose
```

## Why this stack

### Next.js + React

Good for building a fast dashboard with scanner tables, watchlists, forms, and chart views.

### TypeScript

Improves reliability as the project grows and data structures become more complex.

### TailwindCSS

Fast UI development without spending too much time on design decisions.

### FastAPI

Excellent Python backend for APIs, trading logic, scanner calculations, risk rules, and future data ingestion.

### PostgreSQL

Reliable database for:

- Tickers
- Scanner snapshots
- Watchlists
- Trade plans
- Trades
- Journal notes
- Risk settings

## Future additions

Only add these after the MVP works:

- A cache or queue only when a measured use case requires one
- TimescaleDB for large candle/time-series storage
- Paid real-time market data provider
- Paid news provider
- Broker API
- Paper trading integration
- Screenshot storage
- Cloud hosting

## Possible paid data providers later

- Alpaca
- Polygon.io
- Benzinga
- Financial Modeling Prep
- Interactive Brokers

Start without them.
