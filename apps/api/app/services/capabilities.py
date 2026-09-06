"""Persisted provider capability checks."""

from __future__ import annotations

import hashlib

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.integrations import ProviderCapabilityCheck
from app.providers.alpaca_capabilities import AlpacaCapabilityProbe, AlpacaCapabilityResult


async def probe_alpaca_capabilities(
    db: Session,
    settings: Settings,
    *,
    probe: AlpacaCapabilityProbe | None = None,
) -> list[ProviderCapabilityCheck]:
    if not settings.alpaca_configured:
        raise ValueError("Add Alpaca paper credentials before running a capability probe.")
    if not settings.alpaca_paper_mode or settings.allow_live_trading:
        raise ValueError("Capability probing is restricted to the exact Alpaca paper endpoint.")

    provider = probe or AlpacaCapabilityProbe(
        settings.alpaca_api_key_id,
        settings.alpaca_api_secret_key,
        data_base_url=settings.alpaca_data_base_url,
        trading_base_url=settings.alpaca_trading_base_url,
    )
    try:
        results = await provider.probe(
            scanner_feed=settings.alpaca_scanner_feed,
            execution_feed=settings.alpaca_execution_feed,
        )
    finally:
        if probe is None:
            await provider.aclose()

    checks = [_to_model(result) for result in results]
    for check in checks:
        check.details = {**check.details, "configuration_fingerprint": capability_configuration_fingerprint(settings)}
    try:
        db.add_all(checks)
        db.commit()
    except Exception:
        db.rollback()
        raise
    for check in checks:
        db.refresh(check)
    return checks


def capability_configuration_fingerprint(settings: Settings) -> str:
    """Bind recorded access to credentials and endpoints without persisting secrets."""
    configuration = "\n".join((
        settings.alpaca_api_key_id, settings.alpaca_api_secret_key,
        settings.alpaca_data_base_url.rstrip("/"), settings.alpaca_trading_base_url.rstrip("/"),
    ))
    return hashlib.sha256(configuration.encode()).hexdigest()


def latest_capability_checks(db: Session) -> list[ProviderCapabilityCheck]:
    rows = (
        db.query(ProviderCapabilityCheck)
        .order_by(ProviderCapabilityCheck.tested_at.desc(), ProviderCapabilityCheck.id.desc())
        .all()
    )
    latest: dict[tuple[str, str], ProviderCapabilityCheck] = {}
    for row in rows:
        latest.setdefault((row.provider, row.capability), row)
    return list(latest.values())


def _to_model(result: AlpacaCapabilityResult) -> ProviderCapabilityCheck:
    return ProviderCapabilityCheck(
        provider="alpaca",
        capability=result.capability,
        endpoint=result.endpoint,
        source_feed=result.source_feed,
        status=result.status,
        http_status=result.http_status,
        request_id=result.request_id,
        message=result.message,
        details=result.details,
        tested_at=result.tested_at,
    )
