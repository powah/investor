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

## Implemented MVP

The repository now includes the local-first MVP described in the docs:

- `apps/api`: FastAPI backend with PostgreSQL persistence, CSV seeding, scoring, watchlist, catalyst, risk settings, trade planner, journal, analytics, and risk-state endpoints.
- `apps/web`: Next.js + TypeScript + Tailwind dashboard for the scanner workflow, risk planning, journaling, and analytics.
- `data`: sample scanner, manual news, and trades CSV files.
- `docker-compose.yml`: PostgreSQL, Redis, API, and web services for local runtime.

## Run locally

Install Docker, then start the stack from the repo root:

```bash
docker compose up --build
```

Local URLs:

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API health check: http://localhost:8000/health
