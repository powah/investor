# Local Development Plan

## Goal

Run the entire project locally with no hosting costs.

## Local services

```text
Frontend: localhost:3000
Backend API: localhost:8000
PostgreSQL: localhost:5432
Redis: localhost:6379
```

## Recommended folder structure

```text
trading-tool/
  apps/
    web/
    api/
  data/
    sample_scanner_data.csv
    manual_news.csv
    trades.csv
  docs/
  docker-compose.yml
  .env.example
```

## Docker Compose starting point

```yaml
services:
  postgres:
    image: postgres:16
    container_name: trading_postgres
    environment:
      POSTGRES_USER: trading
      POSTGRES_PASSWORD: trading
      POSTGRES_DB: trading_tool
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7
    container_name: trading_redis
    ports:
      - "6379:6379"

  api:
    build: ./apps/api
    container_name: trading_api
    env_file:
      - .env
    ports:
      - "8000:8000"
    depends_on:
      - postgres
      - redis

  web:
    build: ./apps/web
    container_name: trading_web
    ports:
      - "3000:3000"
    depends_on:
      - api

volumes:
  postgres_data:
```

## First sample scanner CSV

```csv
ticker,price,gap_pct,rel_volume,float_m,market_cap_m,spread_pct,catalyst_type,above_vwap,news_headline
SINT,2.35,42,18.4,8.2,21,0.9,FDA,true,Positive Phase 2 clinical data announced
ABVC,3.12,27,9.1,12.5,38,1.2,Contract,true,Company announces new distribution agreement
XYZ,1.84,16,4.3,55.0,120,2.4,Vague PR,false,Company provides strategic update
```

## First development steps

1. Create repo structure.
2. Create Docker Compose file.
3. Create database tables.
4. Build scanner table UI.
5. Import CSV scanner data.
6. Implement scoring model.
7. Add ticker detail page.
8. Add risk calculator.
9. Add journal.
10. Add analytics.
