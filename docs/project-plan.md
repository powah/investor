# Project Plan

## Project name

Small-Cap Catalyst Momentum Trading Tool

## Goal

Build a private web-based decision-support system for finding, ranking, planning, and journaling U.S. small-cap catalyst-driven momentum trades.

The first version should help the user:

1. Find small-cap stocks with unusual movement.
2. Understand why they are moving.
3. Rank them by quality.
4. Define trade risk before entry.
5. Track execution and mistakes.
6. Avoid emotional and oversized trades.

## Product principle

The tool should not tell the user to buy or sell. It should present structured information and risk warnings.

Preferred language inside the tool:

- "Watch"
- "Valid over level"
- "Invalid below level"
- "Risk too high"
- "Spread too wide"
- "No fresh catalyst"

Avoid:

- "Buy now"
- "Guaranteed setup"
- "Signal"
- "Prediction"

## First milestone

A local scanner dashboard that can import sample/manual data and rank small-cap stocks by:

- Gap percentage
- Relative volume
- Catalyst quality
- Float
- Spread
- VWAP status
- Risk condition

## Definition of done for first milestone

- App runs locally with Docker Compose.
- Scanner table loads from CSV or local database.
- Tickers receive a 0-100 score.
- User can save tickers to a watchlist.
- User can create a trade plan with entry, stop, risk, and position size.
- User can add journal notes.
- Data persists in PostgreSQL.

## Important constraint

Do not build auto-trading first. Validate the workflow manually before connecting to broker execution.
