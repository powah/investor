from __future__ import annotations

import csv
from collections import Counter
from datetime import date
from math import isfinite
from io import StringIO

from pydantic import ValidationError

from app.schemas.scanner_sessions import (
    MAX_SUPPLEMENTARY_INPUTS,
    SupplementaryDiscoveryInput,
)


MAX_SUPPLEMENTARY_CSV_BYTES = 5 * 1024 * 1024


class SupplementaryCsvError(ValueError):
    def __init__(self, errors: list[dict[str, object]]):
        self.errors = errors
        super().__init__("Supplementary discovery CSV validation failed.")


def _error(row: int | None, field: str, message: str) -> dict[str, object]:
    return {"row": row, "field": field, "message": message}


def _optional(value: str | None) -> str | None:
    text = (value or "").strip()
    return text or None


def _boolean(value: str | None, *, row: int, errors: list[dict[str, object]]) -> bool | None:
    text = (value or "").strip().lower()
    if not text:
        return None
    if text in {"true", "1", "yes", "y"}:
        return True
    if text in {"false", "0", "no", "n"}:
        return False
    errors.append(_error(row, "foreign_issuer", "Use true/false, 1/0, yes/no, or leave blank."))
    return None


def _date(value: str | None, *, row: int, field: str, errors: list[dict[str, object]]) -> date | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        errors.append(_error(row, field, "Use an ISO date in YYYY-MM-DD format or leave blank."))
        return None


def _ratio(value: str | None, *, row: int, errors: list[dict[str, object]]) -> float | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        ratio = float(text)
    except ValueError:
        errors.append(_error(row, "depositary_to_underlying_ratio", "Use a positive number or leave blank."))
        return None
    if not isfinite(ratio) or ratio <= 0:
        errors.append(_error(row, "depositary_to_underlying_ratio", "Use a positive number or leave blank."))
        return None
    return ratio


def parse_supplementary_csv(content: bytes, *, filename: str) -> list[SupplementaryDiscoveryInput]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise SupplementaryCsvError([_error(None, "file", "CSV must be UTF-8 encoded.")]) from exc

    reader = csv.DictReader(StringIO(text, newline=""), strict=True)
    try:
        raw_headers = reader.fieldnames
    except csv.Error as exc:
        raise SupplementaryCsvError([_error(1, "headers", f"Malformed CSV header: {exc}.")]) from exc
    if not raw_headers:
        raise SupplementaryCsvError([_error(1, "headers", "A header row is required.")])

    headers = [(header or "").strip().lower() for header in raw_headers]
    errors: list[dict[str, object]] = []
    if any(not header for header in headers):
        errors.append(_error(1, "headers", "Header names cannot be blank."))
    duplicates = sorted(name for name, count in Counter(headers).items() if name and count > 1)
    if duplicates:
        errors.append(_error(1, "headers", f"Duplicate columns: {', '.join(duplicates)}."))
    if "ticker" not in headers:
        errors.append(_error(1, "headers", "Missing required column: ticker."))
    if errors:
        raise SupplementaryCsvError(errors)
    reader.fieldnames = headers

    inputs: list[SupplementaryDiscoveryInput] = []
    logical_row = 1
    data_rows = 0
    try:
        for logical_row, raw in enumerate(reader, start=2):
            data_rows += 1
            if data_rows > MAX_SUPPLEMENTARY_INPUTS:
                errors.append(
                    _error(
                        logical_row,
                        "rows",
                        f"At most {MAX_SUPPLEMENTARY_INPUTS} data rows are allowed.",
                    )
                )
                break
            if raw.get(None):
                errors.append(
                    _error(
                        logical_row,
                        "row",
                        "The row contains more values than the header defines.",
                    )
                )
                continue
            if all(value is None or not value.strip() for value in raw.values()):
                continue
            row = logical_row
            row_error_count = len(errors)
            ticker = (raw.get("ticker") or "").strip()
            if not ticker:
                errors.append(_error(row, "ticker", "A ticker is required."))
            effective_from = _date(raw.get("effective_from"), row=row, field="effective_from", errors=errors)
            effective_to = _date(raw.get("effective_to"), row=row, field="effective_to", errors=errors)
            foreign_issuer = _boolean(raw.get("foreign_issuer"), row=row, errors=errors)
            ratio = _ratio(raw.get("depositary_to_underlying_ratio"), row=row, errors=errors)
            if len(errors) != row_error_count:
                continue
            provided_reference = _optional(raw.get("source_reference"))
            provenance = f"{filename}:{row}"
            if provided_reference:
                provenance = f"{provenance} · {provided_reference}"
            try:
                inputs.append(
                    SupplementaryDiscoveryInput(
                        source="csv",
                        source_reference=provenance,
                        ticker=ticker,
                        discovery_reason=_optional(raw.get("discovery_reason")) or "Supplementary CSV input",
                        security_identifier_source=_optional(raw.get("security_identifier_source")),
                        security_identifier=_optional(raw.get("security_identifier")),
                        issuer_name=_optional(raw.get("issuer_name")),
                        exchange=_optional(raw.get("exchange")),
                        listing_status=_optional(raw.get("listing_status")),
                        instrument_type=_optional(raw.get("instrument_type")),
                        effective_from=effective_from,
                        effective_to=effective_to,
                        foreign_issuer=foreign_issuer,
                        depositary_to_underlying_ratio=ratio,
                    )
                )
            except ValidationError as exc:
                for validation_error in exc.errors():
                    errors.append(
                        _error(
                            row,
                            ".".join(str(part) for part in validation_error["loc"]),
                            validation_error["msg"],
                        )
                    )
    except csv.Error as exc:
        errors.append(_error(logical_row, "row", f"Malformed CSV: {exc}."))

    if errors:
        raise SupplementaryCsvError(errors)
    if not inputs:
        raise SupplementaryCsvError([_error(None, "rows", "At least one data row is required.")])
    return inputs
