from __future__ import annotations

import csv
from collections import Counter
from io import StringIO
from math import isfinite

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.models.trading import ScannerSymbol
from app.schemas.trading import ScannerSymbolCreate


REQUIRED_SCANNER_COLUMNS = (
    "ticker",
    "price",
    "gap_pct",
    "rel_volume",
    "float_m",
    "market_cap_m",
    "spread_pct",
    "catalyst_type",
    "above_vwap",
    "news_headline",
)
NUMERIC_SCANNER_COLUMNS = (
    "price",
    "gap_pct",
    "rel_volume",
    "float_m",
    "market_cap_m",
    "spread_pct",
)
OPTIONAL_BOOLEAN_COLUMNS = (
    "clean_daily_chart_room",
    "holding_key_level",
    "no_dilution_red_flag",
)
TRUE_VALUES = {"1", "true", "yes", "y"}
FALSE_VALUES = {"0", "false", "no", "n"}


class ScannerCsvEncodingError(ValueError):
    pass


class ScannerCsvValidationError(ValueError):
    def __init__(self, errors: list[dict[str, object]]):
        self.errors = errors
        super().__init__("Scanner CSV validation failed.")


def _error(*, row: int | None, field: str, message: str) -> dict[str, object]:
    return {"row": row, "field": field, "message": message}


def _parse_number(
    value: str | None,
    *,
    row_number: int,
    field: str,
    errors: list[dict[str, object]],
) -> float | None:
    text = (value or "").strip()
    if not text:
        errors.append(_error(row=row_number, field=field, message="A numeric value is required."))
        return None

    try:
        number = float(text)
    except ValueError:
        errors.append(_error(row=row_number, field=field, message=f"'{text}' is not a valid number."))
        return None

    if not isfinite(number):
        errors.append(_error(row=row_number, field=field, message="The number must be finite."))
        return None
    return number


def _parse_boolean(
    value: str | None,
    *,
    row_number: int,
    field: str,
    errors: list[dict[str, object]],
) -> bool | None:
    text = (value or "").strip().lower()
    if text in TRUE_VALUES:
        return True
    if text in FALSE_VALUES:
        return False

    errors.append(
        _error(
            row=row_number,
            field=field,
            message="Use true/false, 1/0, yes/no, or y/n.",
        )
    )
    return None


def parse_scanner_csv(content: bytes) -> list[ScannerSymbolCreate]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ScannerCsvEncodingError("Scanner CSV must be UTF-8 encoded.") from exc

    reader = csv.DictReader(StringIO(text, newline=""), strict=True)
    try:
        raw_headers = reader.fieldnames
    except csv.Error as exc:
        raise ScannerCsvValidationError(
            [_error(row=1, field="headers", message=f"Malformed CSV header: {exc}.")]
        ) from exc

    if not raw_headers:
        raise ScannerCsvValidationError(
            [_error(row=1, field="headers", message="A header row is required.")]
        )

    headers = [(header or "").strip().lower() for header in raw_headers]
    header_errors: list[dict[str, object]] = []
    if any(not header for header in headers):
        header_errors.append(_error(row=1, field="headers", message="Header names cannot be blank."))

    duplicate_headers = sorted(header for header, count in Counter(headers).items() if header and count > 1)
    if duplicate_headers:
        header_errors.append(
            _error(
                row=1,
                field="headers",
                message=f"Duplicate columns: {', '.join(duplicate_headers)}.",
            )
        )

    missing_headers = sorted(set(REQUIRED_SCANNER_COLUMNS) - set(headers))
    if missing_headers:
        header_errors.append(
            _error(
                row=1,
                field="headers",
                message=f"Missing required columns: {', '.join(missing_headers)}.",
            )
        )

    if header_errors:
        raise ScannerCsvValidationError(header_errors)

    reader.fieldnames = headers
    errors: list[dict[str, object]] = []
    payloads: list[ScannerSymbolCreate] = []
    seen_tickers: dict[str, int] = {}

    try:
        for row in reader:
            row_number = reader.line_num
            row_values = [value for field, value in row.items() if field is not None]
            extra_values = row.get(None)
            if not extra_values and all(value is None or not value.strip() for value in row_values):
                continue

            row_error_count = len(errors)
            if extra_values:
                errors.append(
                    _error(
                        row=row_number,
                        field="row",
                        message="The row contains more values than the header defines.",
                    )
                )

            ticker_value = row.get("ticker")
            ticker = (ticker_value or "").strip().upper()
            if not ticker:
                errors.append(_error(row=row_number, field="ticker", message="A ticker is required."))
            elif ticker in seen_tickers:
                errors.append(
                    _error(
                        row=row_number,
                        field="ticker",
                        message=f"Duplicate ticker; first seen on row {seen_tickers[ticker]}.",
                    )
                )
            else:
                seen_tickers[ticker] = row_number

            numeric_values = {
                field: _parse_number(row.get(field), row_number=row_number, field=field, errors=errors)
                for field in NUMERIC_SCANNER_COLUMNS
            }
            above_vwap = _parse_boolean(
                row.get("above_vwap"),
                row_number=row_number,
                field="above_vwap",
                errors=errors,
            )
            for field in ("catalyst_type", "news_headline"):
                if row.get(field) is None:
                    errors.append(
                        _error(
                            row=row_number,
                            field=field,
                            message="A value is required; use an empty field when unknown.",
                        )
                    )

            data: dict[str, object] = {
                "ticker": ticker,
                **numeric_values,
                "catalyst_type": (row.get("catalyst_type") or "").strip() or None,
                "above_vwap": above_vwap,
                "news_headline": (row.get("news_headline") or "").strip() or None,
            }
            for field in OPTIONAL_BOOLEAN_COLUMNS:
                raw_value = row.get(field)
                if field in headers and raw_value is not None and raw_value.strip():
                    data[field] = _parse_boolean(
                        raw_value,
                        row_number=row_number,
                        field=field,
                        errors=errors,
                    )

            if len(errors) != row_error_count:
                continue

            try:
                payloads.append(ScannerSymbolCreate.model_validate(data))
            except ValidationError as exc:
                for validation_error in exc.errors():
                    errors.append(
                        _error(
                            row=row_number,
                            field=".".join(str(part) for part in validation_error["loc"]),
                            message=validation_error["msg"],
                        )
                    )
    except csv.Error as exc:
        errors.append(
            _error(
                row=reader.line_num or None,
                field="row",
                message=f"Malformed CSV: {exc}.",
            )
        )

    if errors:
        raise ScannerCsvValidationError(errors)
    if not payloads:
        raise ScannerCsvValidationError(
            [_error(row=None, field="rows", message="At least one data row is required.")]
        )
    return payloads


def upsert_scanner_symbols(
    db: Session,
    payloads: list[ScannerSymbolCreate],
    *,
    data_origin: str = "manual_import",
) -> list[ScannerSymbol]:
    tickers = [payload.ticker for payload in payloads]
    existing = {
        symbol.ticker: symbol
        for symbol in db.query(ScannerSymbol).filter(ScannerSymbol.ticker.in_(tickers)).all()
    }
    symbols: list[ScannerSymbol] = []

    try:
        for payload in payloads:
            symbol = existing.get(payload.ticker)
            if symbol is None:
                symbol = ScannerSymbol(ticker=payload.ticker)
                db.add(symbol)

            values = payload.model_dump(include=payload.model_fields_set)
            values.pop("ticker", None)
            for field, value in values.items():
                setattr(symbol, field, value)
            symbol.data_origin = data_origin
            symbols.append(symbol)
        db.commit()
    except Exception:
        db.rollback()
        raise

    for symbol in symbols:
        db.refresh(symbol)
    return symbols


def import_scanner_csv_data(
    db: Session,
    content: bytes,
    *,
    data_origin: str = "manual_import",
) -> list[ScannerSymbol]:
    payloads = parse_scanner_csv(content)
    return upsert_scanner_symbols(db, payloads, data_origin=data_origin)
