"""Small normalization helpers shared by feed adapters."""

import re
from datetime import date, datetime, timezone
from typing import Any, Optional, Tuple


_BASIC_TIME = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2})T"
    r"(?P<hour>\d{2})(?P<minute>\d{2})(?P<second>\d{2})"
    r"(?P<rest>.*)$"
)
_FRACTION = re.compile(r"\.([0-9]+)")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_datetime(value: Any) -> Optional[datetime]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        normalized = str(value).strip()
        basic_match = _BASIC_TIME.match(normalized)
        if basic_match:
            normalized = (
                f"{basic_match.group('date')}T{basic_match.group('hour')}:"
                f"{basic_match.group('minute')}:{basic_match.group('second')}"
                f"{basic_match.group('rest')}"
            )
        fraction_match = _FRACTION.search(normalized)
        if fraction_match:
            normalized_fraction = fraction_match.group(1)[:6].ljust(6, "0")
            normalized = (
                normalized[: fraction_match.start(1)]
                + normalized_fraction
                + normalized[fraction_match.end(1) :]
            )
        if normalized.endswith(("Z", "z")):
            normalized = normalized[:-1] + "+00:00"
        parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def parse_date(value: Any) -> Optional[date]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value).strip())


def optional_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    return float(value)


def optional_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    return int(value)


def string_tuple(value: Any, *, separator: Optional[str] = None) -> Tuple[str, ...]:
    if value is None or value == "":
        return ()
    if isinstance(value, str):
        values = value.split(separator) if separator else (value,)
    else:
        values = value
    return tuple(str(item).strip() for item in values if str(item).strip())
