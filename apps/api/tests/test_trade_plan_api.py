import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.routes import preview_trade_plan
from app.core.database import Base
from app.models.trading import TradePlan
from app.schemas.trading import RiskSettingsUpdate, TradePlanCreate


@pytest.mark.parametrize(
    ("schema", "payload"),
    [
        (
            TradePlanCreate,
            {
                "ticker": "SINT",
                "entry_price": 4.2,
                "stop_price": 4.0,
                "max_risk_per_trade_pct": 100.01,
            },
        ),
        (RiskSettingsUpdate, {"max_risk_per_trade_pct": 100.01}),
    ],
)
def test_risk_percentage_cannot_exceed_one_hundred(schema, payload):
    with pytest.raises(ValidationError):
        schema.model_validate(payload)


def test_trade_plan_preview_returns_metrics_without_persisting_plan():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)

    with Session(engine) as db:
        payload = TradePlanCreate(
            ticker="SINT",
            account_size=10_000,
            max_risk_per_trade_pct=0.5,
            entry_price=4.20,
            stop_price=4.00,
            target_price=4.60,
        )

        preview = preview_trade_plan(payload, db)

        assert preview.risk_per_share == 0.20
        assert preview.shares == 250
        assert preview.max_loss == 50.00
        assert preview.r_multiple == 2.00
        assert preview.blockers == []
        assert db.query(TradePlan).count() == 0
