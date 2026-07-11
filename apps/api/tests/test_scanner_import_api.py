from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes import router
from app.core.database import Base, get_db


HEADERS = (
    "ticker,price,gap_pct,rel_volume,float_m,market_cap_m,spread_pct,"
    "catalyst_type,above_vwap,news_headline"
)


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    testing_session = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    Base.metadata.create_all(engine)

    def override_get_db():
        with testing_session() as db:
            yield db

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client


def _upload(client: TestClient, csv_text: str):
    return client.post(
        "/scanner/import-csv",
        files={"file": ("scanner.csv", csv_text.encode("utf-8"), "text/csv")},
    )


def test_import_csv_normalizes_and_returns_ranked_symbols(client: TestClient):
    csv_text = "\n".join(
        [
            HEADERS,
            "xyz,1.84,16,4.3,55,120,2.4,Vague PR,no,Company provides strategic update",
            " sint ,2.35,42,18.4,8.2,21,0.9,FDA,YES,Positive Phase 2 data announced",
        ]
    )

    response = _upload(client, csv_text)

    assert response.status_code == 200
    symbols = response.json()
    assert [symbol["ticker"] for symbol in symbols] == ["SINT", "XYZ"]
    assert symbols[0]["above_vwap"] is True
    assert symbols[1]["above_vwap"] is False
    assert symbols[0]["score"] > symbols[1]["score"]
    assert symbols[0]["clean_daily_chart_room"] is False
    assert symbols[0]["holding_key_level"] is False
    assert symbols[0]["no_dilution_red_flag"] is False


def test_scanner_score_uses_latest_published_catalyst(client: TestClient):
    csv_text = "\n".join(
        [
            HEADERS,
            "SINT,2.35,42,18.4,8.2,21,0.9,FDA,true,CSV headline",
        ]
    )
    assert _upload(client, csv_text).status_code == 200

    now = datetime.now(timezone.utc)
    latest_published = now - timedelta(hours=1)
    older_published = now - timedelta(hours=24)
    for published_time, quality_score, headline in (
        (latest_published, 7, "Latest published catalyst"),
        (older_published, 20, "Later-created but older catalyst"),
    ):
        response = client.post(
            "/catalysts",
            json={
                "ticker": "SINT",
                "published_time": published_time.isoformat(),
                "source": "Test",
                "headline": headline,
                "catalyst_type": "FDA",
                "quality_score": quality_score,
            },
        )
        assert response.status_code == 201

    symbol = client.get("/scanner").json()[0]
    assert symbol["latest_catalyst_quality_score"] == 7
    assert symbol["latest_catalyst_is_fresh"] is True
    assert symbol["news_headline"] == "Latest published catalyst"


def test_import_csv_rejects_missing_headers(client: TestClient):
    csv_text = "\n".join(
        [
            HEADERS.removesuffix(",news_headline"),
            "SINT,2.35,42,18.4,8.2,21,0.9,FDA,true",
        ]
    )

    response = _upload(client, csv_text)

    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["message"] == "Scanner CSV validation failed."
    assert detail["errors"] == [
        {
            "row": 1,
            "field": "headers",
            "message": "Missing required columns: news_headline.",
        }
    ]


def test_import_csv_reports_malformed_number(client: TestClient):
    csv_text = "\n".join(
        [
            HEADERS,
            "SINT,not-a-number,42,18.4,8.2,21,0.9,FDA,true,Positive Phase 2 data announced",
        ]
    )

    response = _upload(client, csv_text)

    assert response.status_code == 422
    assert {
        "row": 2,
        "field": "price",
        "message": "'not-a-number' is not a valid number.",
    } in response.json()["detail"]["errors"]


def test_import_csv_is_atomic_when_any_row_is_invalid(client: TestClient):
    initial = "\n".join(
        [
            HEADERS,
            "SINT,2.35,42,18.4,8.2,21,0.9,FDA,true,Positive Phase 2 data announced",
        ]
    )
    assert _upload(client, initial).status_code == 200

    invalid_update = "\n".join(
        [
            HEADERS,
            "SINT,9.99,42,18.4,8.2,21,0.9,FDA,true,Changed headline",
            "ABVC,bad-price,27,9.1,12.5,38,1.2,Contract,true,Distribution agreement",
        ]
    )

    response = _upload(client, invalid_update)

    assert response.status_code == 422
    scanner = client.get("/scanner").json()
    assert [(symbol["ticker"], symbol["price"]) for symbol in scanner] == [("SINT", 2.35)]
