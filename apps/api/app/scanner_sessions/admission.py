from __future__ import annotations

from datetime import date, datetime

from sqlalchemy.orm import Session

from app.models.scanner_sessions import (
    DiscoveryHit,
    Listing,
    ScannerSession,
    ScannerSessionCandidate,
    Security,
)
from app.schemas.scanner_sessions import SupplementaryDiscoveryInput


ELIGIBLE_EXCHANGES = {"nasdaq", "nyse", "nyse_american"}
ELIGIBLE_INSTRUMENT_TYPES = {"common_stock", "american_depositary_share"}
_UNKNOWN_VALUES = {"", "unknown", "unresolved"}


def _token(value: str | None) -> str | None:
    if value is None:
        return None
    token = value.strip().lower().replace("-", "_").replace(" ", "_")
    return token or None


def _exchange(value: str | None) -> str | None:
    token = _token(value)
    aliases = {
        "new_york_stock_exchange": "nyse",
        "nyse_american_llc": "nyse_american",
        "nyse_american": "nyse_american",
        "nyse_mkt": "nyse_american",
    }
    return aliases.get(token, token)


def _instrument_type(value: str | None) -> str | None:
    token = _token(value)
    aliases = {
        "common": "common_stock",
        "common_share": "common_stock",
        "american_depositary_shares": "american_depositary_share",
        "ads": "american_depositary_share",
        "adr": "american_depositary_share",
    }
    return aliases.get(token, token)


def _security(db: Session, item: SupplementaryDiscoveryInput) -> Security | None:
    source = _token(item.security_identifier_source)
    identifier = (item.security_identifier or "").strip()
    if not source or not identifier:
        return None
    security = (
        db.query(Security)
        .filter(Security.identifier_source == source, Security.identifier == identifier)
        .one_or_none()
    )
    if security is None:
        security = Security(
            identifier_source=source,
            identifier=identifier,
            issuer_name=(item.issuer_name or "").strip() or None,
        )
        db.add(security)
        db.flush()
    return security


def _listing(
    db: Session,
    *,
    security: Security | None,
    ticker: str,
    exchange: str | None,
    status: str | None,
    instrument_type: str | None,
    item: SupplementaryDiscoveryInput,
) -> tuple[Listing | None, bool]:
    if (
        security is None
        or exchange is None
        or exchange in _UNKNOWN_VALUES
        or status is None
        or status in _UNKNOWN_VALUES
        or instrument_type is None
        or instrument_type in _UNKNOWN_VALUES
        or item.effective_from is None
        or (item.effective_to is not None and item.effective_to < item.effective_from)
        or (instrument_type == "american_depositary_share" and item.foreign_issuer is None)
    ):
        return None, False
    listing = (
        db.query(Listing)
        .filter(
            Listing.security_id == security.id,
            Listing.ticker == ticker,
            Listing.exchange == exchange,
            Listing.effective_from == item.effective_from,
        )
        .one_or_none()
    )
    if listing is None:
        listing = Listing(
            security_id=security.id,
            ticker=ticker,
            exchange=exchange,
            status=status,
            instrument_type=instrument_type,
            effective_from=item.effective_from,
            effective_to=item.effective_to,
            foreign_issuer=item.foreign_issuer,
            depositary_to_underlying_ratio=item.depositary_to_underlying_ratio,
        )
        db.add(listing)
        db.flush()
        return listing, False

    required_conflict = (
        listing.status != status or listing.instrument_type != instrument_type
    )
    optional_observations = (
        ("effective_to", item.effective_to),
        ("foreign_issuer", item.foreign_issuer),
        (
            "depositary_to_underlying_ratio",
            item.depositary_to_underlying_ratio,
        ),
    )
    optional_conflict = any(
        observed is not None
        and getattr(listing, attribute) is not None
        and getattr(listing, attribute) != observed
        for attribute, observed in optional_observations
    )
    if required_conflict or optional_conflict:
        return None, True

    enriched = False
    for attribute, observed in optional_observations:
        if getattr(listing, attribute) is None and observed is not None:
            setattr(listing, attribute, observed)
            enriched = True
    if enriched:
        db.flush()
    return listing, False


def _admission(
    *,
    trading_date: date,
    item: SupplementaryDiscoveryInput,
    security: Security | None,
    listing: Listing | None,
    listing_conflict: bool,
    exchange: str | None,
    status: str | None,
    instrument_type: str | None,
) -> tuple[str, list[str]]:
    unresolved: list[str] = []
    if security is None:
        unresolved.append("security_identity_unresolved")
    if exchange is None or exchange in _UNKNOWN_VALUES:
        unresolved.append("listing_exchange_unresolved")
    if status is None or status in _UNKNOWN_VALUES:
        unresolved.append("listing_status_unresolved")
    if instrument_type is None or instrument_type in _UNKNOWN_VALUES:
        unresolved.append("instrument_classification_unresolved")
    if item.effective_from is None:
        unresolved.append("listing_effective_date_unresolved")
    if item.effective_from and item.effective_to and item.effective_to < item.effective_from:
        unresolved.append("listing_effective_dates_invalid")
    if listing_conflict:
        unresolved.append("listing_identity_conflict")
    if instrument_type == "american_depositary_share" and item.foreign_issuer is None:
        unresolved.append("foreign_issuer_status_unresolved")
    if unresolved:
        return "unresolved", unresolved

    rejected: list[str] = []
    effective_from = listing.effective_from if listing is not None else item.effective_from
    effective_to = listing.effective_to if listing is not None else item.effective_to
    if exchange not in ELIGIBLE_EXCHANGES:
        rejected.append("unsupported_exchange")
    if status != "active":
        rejected.append("listing_not_active")
    if effective_from is not None and (
        effective_from > trading_date
        or (effective_to is not None and effective_to < trading_date)
    ):
        rejected.append("listing_not_active_on_trading_date")
    if instrument_type not in ELIGIBLE_INSTRUMENT_TYPES:
        rejected.append("unsupported_instrument_type")
    if instrument_type == "american_depositary_share" and item.foreign_issuer is not True:
        rejected.append("american_depositary_share_not_foreign_issuer")
    if rejected:
        return "rejected", rejected
    if listing is None:
        return "unresolved", ["listing_identity_unresolved"]
    return "admitted", ["target_instrument_universe"]


def admit_supplementary_inputs(
    db: Session,
    *,
    session: ScannerSession,
    inputs: list[SupplementaryDiscoveryInput],
    observed_at: datetime,
) -> None:
    for item in inputs:
        ticker = item.ticker.strip().upper()
        exchange = _exchange(item.exchange)
        status = _token(item.listing_status)
        instrument_type = _instrument_type(item.instrument_type)
        security = _security(db, item)
        listing, listing_conflict = _listing(
            db,
            security=security,
            ticker=ticker,
            exchange=exchange,
            status=status,
            instrument_type=instrument_type,
            item=item,
        )
        outcome, reasons = _admission(
            trading_date=session.trading_date,
            item=item,
            security=security,
            listing=listing,
            listing_conflict=listing_conflict,
            exchange=exchange,
            status=status,
            instrument_type=instrument_type,
        )

        candidate: ScannerSessionCandidate | None = None
        if outcome == "admitted" and security is not None:
            candidate = (
                db.query(ScannerSessionCandidate)
                .filter(
                    ScannerSessionCandidate.scanner_session_id == session.id,
                    ScannerSessionCandidate.security_id == security.id,
                )
                .one_or_none()
            )
            if candidate is None:
                candidate = ScannerSessionCandidate(
                    scanner_session_id=session.id,
                    security_id=security.id,
                )
                db.add(candidate)
                db.flush()

        db.add(
            DiscoveryHit(
                scanner_session_id=session.id,
                security_id=security.id if security is not None else None,
                listing_id=listing.id if listing is not None else None,
                candidate_id=candidate.id if candidate is not None else None,
                source=item.source,
                source_reference=item.source_reference.strip(),
                observed_at=item.observed_at or observed_at,
                ticker=ticker,
                observed_exchange=exchange,
                observed_listing_status=status,
                observed_instrument_type=instrument_type,
                observed_effective_from=item.effective_from,
                observed_effective_to=item.effective_to,
                observed_foreign_issuer=item.foreign_issuer,
                observed_depositary_to_underlying_ratio=(
                    item.depositary_to_underlying_ratio
                ),
                discovery_reason=item.discovery_reason.strip(),
                admission_outcome=outcome,
                admission_reasons=reasons,
            )
        )
        db.flush()
