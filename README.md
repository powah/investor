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

## Current implementation

The repository contains a usable local decision-support MVP covering the manual workflow from discovery through review:

- Accessible workspace navigation for Scanner, Watchlist, Trade planner, Journal, Analytics, and Risk rules.
- Ranked scanner with search, workflow filters, CSV upload, visible score evidence, catalyst history, and complete risk warnings.
- Explicit watch/unwatch state, a dedicated watchlist view, persisted watch notes, and a direct watchlist-to-plan flow.
- Live pre-trade sizing with entry, stop, target, position size, max loss, R multiple, warnings, and hard blockers.
- Trade plan persistence, plan-to-journal handoff, execution notes, mistake tags, plan-adherence tracking, and basic analytics.
- FastAPI endpoints for scanner imports, catalyst records, watchlists, risk settings/state, non-persisting plan preview, plans, journal entries, and analytics.
- PostgreSQL persistence, Redis in the local stack, Docker Compose runtime, and backend tests for imports and risk enforcement.

This is still a local manual-data system, intentionally. Immutable scanner snapshots, date-scoped watchlist history, replay, external market/news feeds, broker connections, and execution automation remain later roadmap phases. See `docs/roadmap.md`.

## Run locally

Install Docker, then start the stack from the repo root:

```bash
docker compose up --build
```

Local URLs:

- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API health check: http://localhost:8000/health

The web app calls the API through a same-origin `/api` proxy. Docker resolves that proxy to the API service, while local Next.js development defaults to `http://localhost:8000`.

## Verify changes

Frontend:

```bash
cd apps/web
npm run typecheck
npm run lint
npm run build
```

Backend (using the project virtual environment):

```bash
cd apps/api
../../.venv/bin/python -m pytest -q
```
