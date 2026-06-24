import csv
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.trading import Catalyst, RiskSettings, ScannerSymbol


def _bool_from_csv(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "y"}


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


def import_sample_scanner_data(db: Session) -> list[ScannerSymbol]:
    path = _sample_path()
    if not path.exists():
        return []

    symbols: list[ScannerSymbol] = []
    with path.open(newline="") as csvfile:
        reader = csv.DictReader(csvfile)
        for row in reader:
            ticker = row["ticker"].strip().upper()
            symbol = db.query(ScannerSymbol).filter(ScannerSymbol.ticker == ticker).one_or_none()
            if symbol is None:
                symbol = ScannerSymbol(ticker=ticker)
                db.add(symbol)

            symbol.price = float(row["price"])
            symbol.gap_pct = float(row["gap_pct"])
            symbol.rel_volume = float(row["rel_volume"])
            symbol.float_m = float(row["float_m"])
            symbol.market_cap_m = float(row["market_cap_m"])
            symbol.spread_pct = float(row["spread_pct"])
            symbol.catalyst_type = row["catalyst_type"].strip()
            symbol.above_vwap = _bool_from_csv(row["above_vwap"])
            symbol.news_headline = row["news_headline"].strip()
            symbols.append(symbol)

    db.commit()
    for symbol in symbols:
        db.refresh(symbol)
    return symbols


def seed_database(db: Session) -> None:
    ensure_risk_settings(db)
    if db.query(ScannerSymbol).count() == 0:
        symbols = import_sample_scanner_data(db)
        for symbol in symbols:
            if symbol.news_headline:
                db.add(
                    Catalyst(
                        ticker=symbol.ticker,
                        published_time=datetime.utcnow(),
                        source="Sample CSV",
                        headline=symbol.news_headline,
                        catalyst_type=symbol.catalyst_type or "Manual",
                        quality_score=20 if symbol.catalyst_type in {"FDA", "Contract", "Partnership"} else 5,
                    )
                )
        db.commit()
