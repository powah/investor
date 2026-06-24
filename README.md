# Small-Cap Catalyst Momentum Trading Tool

A private trading decision-support tool for scanning, ranking, planning, and journaling small-cap catalyst-driven momentum trades.

This project is designed for personal research and discipline. It should start as a local tool using manual, delayed, or historical data before adding paid real-time data or broker execution.

## Core idea

The tool helps answer:

> Which small-cap stocks are worth watching today, why are they moving, where is the risk, and is the trade valid?

It is not intended to be a guaranteed trading system, signal service, or automatic trading bot.

## Recommended first version

Build a local MVP with:

- Scanner simulator using CSV/manual data
- Catalyst input and classification
- Score ranking from 0 to 100
- Risk calculator
- Watchlist
- Trade planner
- Journal
- Basic analytics

## Local-first approach

Start locally to avoid costs:

```text
Frontend: Next.js + TypeScript + TailwindCSS
Backend: Python FastAPI
Database: PostgreSQL
Cache: Redis
Charts: TradingView Lightweight Charts
Runtime: Docker Compose
```

Only add paid real-time data after the local workflow proves useful.

## Documentation

See the `docs/` folder:

- `project-plan.md`
- `mvp-scope.md`
- `tech-stack.md`
- `scoring-model.md`
- `risk-rules.md`
- `local-development.md`
- `cost-plan.md`
- `roadmap.md`
