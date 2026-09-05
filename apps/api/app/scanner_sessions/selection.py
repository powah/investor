"""Capability-aware discovery, independent of vendor payloads and persistence."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Mapping

from app.scanner_sessions.domain import (
    DiscoveryProgress, DiscoveryResult, DiscoveryUnavailable, MarketMovementDiscovery, NEW_YORK,
    resolve_exchange_session_identity,
)


@dataclass(frozen=True)
class RecordedCapability:
    status: str
    check_id: int
    tested_at: str
    request_id: str | None = None


class CapabilityAwareDiscovery:
    source = "capability_aware_market_movement"

    def __init__(
        self, *, started_at: datetime, capabilities: Mapping[str, RecordedCapability],
        screeners: Mapping[str, MarketMovementDiscovery], fallback: MarketMovementDiscovery,
    ):
        self._identity = resolve_exchange_session_identity(started_at)
        self._capabilities = dict(capabilities)
        self._screeners = dict(screeners)
        self._fallback = fallback

    async def discover(self, *, report_progress: DiscoveryProgress | None = None) -> DiscoveryResult:
        sources: dict[str, Any] = {}
        hits = []
        completed = []
        # Daily screener rankings can still describe the previous regular
        # session even when their update timestamp is today. Never rely on
        # screeners alone before the open.
        needs_fallback = self._identity.market_phase == "premarket"

        def report(message: str) -> None:
            if report_progress:
                report_progress(message, {"sources": sources, "selection_policy": "capability-aware-v1"})

        for name, adapter in self._screeners.items():
            capability = self._capabilities.get(name)
            decision = sources[name] = {
                "status": "pending", "source": adapter.source,
                "capability": vars(capability) if capability else None,
            }
            if capability is None or capability.status != "available":
                decision.update(status="skipped", reason="capability_not_verified")
                needs_fallback = True
            elif self._identity.market_phase == "closed":
                decision.update(status="skipped", reason="market_phase_closed")
                needs_fallback = True
            else:
                decision.update(status="running", reason="recorded_access_available")
                report(f"Requesting {adapter.source} using recorded capability access.")
                try:
                    result = await adapter.discover()
                    result.validate()
                    decision.update(result.details)
                    # Screeners may keep yesterday's regular-session rankings until
                    # the open. A successful request alone does not make them applicable.
                    event = datetime.fromisoformat(result.details["provider_event_at"].replace("Z", "+00:00"))
                    if event.tzinfo is None:
                        raise ValueError("Screener event time must include timezone")
                    current_date = event.astimezone(NEW_YORK).date() == self._identity.trading_date
                    applicable = current_date and self._identity.market_phase != "premarket"
                    decision.update(
                        status="completed" if applicable else "inapplicable",
                        reason=("prior_or_other_trading_date" if not current_date else
                                "premarket_daily_rankings" if not applicable else "current_trading_date"),
                        records_count=result.records_count,
                    )
                    # Retain even inapplicable occurrences for audit, not as proof
                    # that required current Market-Movement Discovery succeeded.
                    hits.extend(hit.model_copy(update={"provenance": {
                        **hit.provenance, "applicable_to_session": applicable,
                        "applicability_reason": decision["reason"],
                    }}) for hit in result.hits)
                    if applicable:
                        completed.append(adapter.source)
                    else:
                        needs_fallback = True
                except Exception as exc:
                    decision.update(
                        status="unavailable" if isinstance(exc, DiscoveryUnavailable) else "failed",
                        reason=getattr(exc, "code", "source_failed"),
                        message=str(exc)[:1000],
                    )
                    if isinstance(exc, DiscoveryUnavailable):
                        decision.update(exc.details)
                    needs_fallback = True
            report(f"{adapter.source}: {decision['status']} ({decision['reason']}).")

        fallback_details = {}
        if needs_fallback or not completed:
            decision = sources[self._fallback.source] = {
                "source": self._fallback.source, "status": "running",
                "reason": "premarket_requires_bars" if self._identity.market_phase == "premarket" else "screener_fallback",
            }
            report("Using delayed consolidated bars: premarket safety or unavailable/inapplicable screeners.")
            try:
                result = await self._fallback.discover()
                result.validate()
                hits.extend(result.hits)
                completed.append(self._fallback.source)
                fallback_details = result.details
                decision.update(result.details, status="completed", records_count=result.records_count)
            except Exception as exc:
                decision.update(status="failed", message=str(exc)[:1000])
                if isinstance(exc, DiscoveryUnavailable):
                    decision.update(exc.details)
                report("Delayed consolidated bar fallback failed.")
                if not completed:
                    raise DiscoveryUnavailable(
                        code="required_discovery_unavailable",
                        message="No applicable Market-Movement Discovery source completed.",
                        details={"sources": sources, "selection_policy": "capability-aware-v1"},
                        hits=tuple(hits),
                    ) from exc
        details = {
            **fallback_details, "sources": sources, "selected_sources": completed,
            "selection_policy": "capability-aware-v1", "fallback_used": needs_fallback or not self._screeners,
        }
        # With several contracts there is no single session-wide Data Tier.
        if len(completed) > 1:
            for key in ("data_tier", "feed", "coverage", "expected_delay_seconds"):
                details.pop(key, None)
        return DiscoveryResult(
            records_count=len(hits), hits=tuple(hits), details=details,
            message="Market-Movement Discovery completed via " + ", ".join(completed) + ".",
        )
