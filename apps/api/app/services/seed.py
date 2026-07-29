from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.trading import Catalyst, RiskSettings, ScannerSymbol
from app.services.scanner_import import import_scanner_csv_data


def _sample_path() -> Path:
    settings = get_settings()
    candidates = [
        Path(settings.sample_data_path),
        Path.cwd() / "data/sample_scanner_data.csv",
    ]
    module_path = Path(__file__).resolve()
    candidates.extend(parent / "data/sample_scanner_data.csv" for parent in module_path.parents)

    for path in candidates:
        if path.exists():
            return path
    return candidates[0]


def ensure_risk_settings(db: Session) -> RiskSettings:
    settings = db.get(RiskSettings, 1)
    if settings is None:
        settings = RiskSettings(id=1)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def import_sample_scanner_data(
    db: Session,
    *,
    data_origin: str = "sample_import",
) -> list[ScannerSymbol]:
    path = _sample_path()
    if not path.exists():
        return []

    return import_scanner_csv_data(db, path.read_bytes(), data_origin=data_origin)


def initialize_application_data(db: Session, *, app_mode: str) -> None:
    ensure_risk_settings(db)
    if app_mode == "demo" and db.query(ScannerSymbol).filter(ScannerSymbol.data_origin == "demo").count() == 0:
        symbols = import_sample_scanner_data(db, data_origin="demo")
        for symbol in symbols:
            if symbol.news_headline:
                db.add(
                    Catalyst(
                        ticker=symbol.ticker,
                        published_time=datetime.now(timezone.utc),
                        source="Sample CSV",
                        headline=symbol.news_headline,
                        catalyst_type=symbol.catalyst_type or "Manual",
                        quality_score=20 if symbol.catalyst_type in {"FDA", "Contract", "Partnership"} else 5,
                    )
                )
        db.commit()
