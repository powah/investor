"""Candidate Evidence persistence and versioned freshness evaluation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from sqlalchemy.orm import Session

from app.models.scanner_sessions import CandidateEvidence, ScannerSessionCandidate


FRESHNESS_POLICY_VERSION = "candidate-evidence-v1"
DEFAULT_DELAYED_CONSOLIDATED_DELAY_SECONDS = 900
FreshnessResult = Literal["fresh", "stale", "unknown"]


@dataclass(frozen=True)
class FreshnessRule:
    max_event_age_seconds: int
    max_observation_age_seconds: int


# Rules are keyed by evidence semantics and Data Tier. Keeping this mapping
# versioned makes historical results stable when a future policy changes a
# limit or adds another evidence type.
FRESHNESS_RULES: dict[str, dict[tuple[str, str], FreshnessRule]] = {
    FRESHNESS_POLICY_VERSION: {
        (evidence_type, data_tier): FreshnessRule(
            max_event_age_seconds=30 * 60,
            max_observation_age_seconds=15 * 60,
        )
        for evidence_type in {
            "market_bar",
            "market_data",
            "market_movement",
            "market_observation",
            "market_price",
            "above_vwap",
            "price",
            "volume",
        }
        for data_tier in {"delayed_consolidated", "delayed_sip"}
    }
}


@dataclass(frozen=True)
class FreshnessAssessment:
    policy_version: str
    result: FreshnessResult
    reason: str
    event_age_seconds: float | None
    observation_age_seconds: float | None


class CandidateEvidenceNotFound(LookupError):
    pass


class CandidateEvidenceValidationError(ValueError):
    pass


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Candidate Evidence times must include a timezone")
    return value.astimezone(timezone.utc)


def _data_tier_for_source(source: str, provenance: dict[str, Any]) -> str:
    data_tier = provenance.get("data_tier")
    if isinstance(data_tier, str) and data_tier.strip():
        return data_tier.strip()
    if source in {"manual", "csv"}:
        return "manual"
    return "unknown"


def _expected_delay(provenance: dict[str, Any], data_tier: str) -> int | None:
    value = provenance.get("expected_delay_seconds")
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and value >= 0:
        return int(value)
    if data_tier in {"delayed_consolidated", "delayed_sip"}:
        return DEFAULT_DELAYED_CONSOLIDATED_DELAY_SECONDS
    return None


def _provider_event_at(provenance: dict[str, Any]) -> datetime | None:
    value = provenance.get("provider_event_at")
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed.astimezone(timezone.utc)


def evaluate_freshness(
    *,
    evidence_type: str,
    data_tier: str,
    event_at: datetime | None,
    observed_at: datetime,
    evaluated_at: datetime,
    policy_version: str = FRESHNESS_POLICY_VERSION,
) -> FreshnessAssessment:
    """Evaluate freshness once and persist the result with the evidence.

    Freshness is independent from Data Tier: the same delayed tier can be
    fresh, stale, or unevaluable depending on event and observation age.
    """

    event_time = _utc(event_at) if event_at is not None else None
    observed_time = _utc(observed_at)
    evaluated_time = _utc(evaluated_at)
    observation_age = (evaluated_time - observed_time).total_seconds()
    event_age = (
        (evaluated_time - event_time).total_seconds() if event_time is not None else None
    )
    rule = FRESHNESS_RULES.get(policy_version, {}).get(
        (evidence_type.strip().lower(), data_tier.strip().lower())
    )

    if observation_age < 0:
        return FreshnessAssessment(
            policy_version=policy_version,
            result="unknown",
            reason="observation_in_future",
            event_age_seconds=event_age,
            observation_age_seconds=observation_age,
        )
    if event_time is not None and event_age is not None and event_age < 0:
        return FreshnessAssessment(
            policy_version=policy_version,
            result="unknown",
            reason="event_in_future",
            event_age_seconds=event_age,
            observation_age_seconds=observation_age,
        )
    if rule is None:
        return FreshnessAssessment(
            policy_version=policy_version,
            result="unknown",
            reason="no_freshness_policy",
            event_age_seconds=event_age,
            observation_age_seconds=observation_age,
        )
    if event_age is None:
        return FreshnessAssessment(
            policy_version=policy_version,
            result="unknown",
            reason="event_time_missing",
            event_age_seconds=None,
            observation_age_seconds=observation_age,
        )
    if event_age > rule.max_event_age_seconds:
        reason = "provider_event_too_old"
        result: FreshnessResult = "stale"
    elif observation_age > rule.max_observation_age_seconds:
        reason = "local_observation_too_old"
        result = "stale"
    else:
        reason = "within_policy_limits"
        result = "fresh"
    return FreshnessAssessment(
        policy_version=policy_version,
        result=result,
        reason=reason,
        event_age_seconds=event_age,
        observation_age_seconds=observation_age,
    )


def append_candidate_evidence(
    db: Session,
    *,
    candidate: ScannerSessionCandidate,
    evidence_type: str,
    value_state: str,
    normalized_value: Any | None,
    source_reference: str,
    event_at: datetime | None,
    observed_at: datetime,
    data_tier: str,
    expected_delay_seconds: int | None,
    evaluated_at: datetime,
    supersedes_evidence_id: int | None = None,
    supersession_type: str | None = None,
) -> CandidateEvidence:
    """Append one immutable Candidate Evidence row and flush its identifier."""

    normalized_type = evidence_type.strip().lower()
    if not normalized_type:
        raise CandidateEvidenceValidationError("Evidence type must not be empty")
    if value_state not in {"known", "unknown", "verified_negative"}:
        raise CandidateEvidenceValidationError("Unsupported Candidate Evidence value state")
    if value_state == "unknown" and normalized_value is not None:
        raise CandidateEvidenceValidationError("Unknown Evidence must not carry a normalized value")
    if value_state != "unknown" and normalized_value is None:
        raise CandidateEvidenceValidationError(
            "Known and Verified Negative Evidence require a normalized value"
        )
    if (supersedes_evidence_id is None) != (supersession_type is None):
        raise CandidateEvidenceValidationError(
            "supersedes_evidence_id and supersession_type must be provided together"
        )
    if supersession_type not in {None, "correction", "new_observation"}:
        raise CandidateEvidenceValidationError("Unsupported Candidate Evidence supersession type")

    if supersedes_evidence_id is not None:
        previous = (
            db.query(CandidateEvidence)
            .filter(
                CandidateEvidence.id == supersedes_evidence_id,
                CandidateEvidence.candidate_id == candidate.id,
            )
            .one_or_none()
        )
        if previous is None:
            raise CandidateEvidenceNotFound(
                f"Candidate Evidence {supersedes_evidence_id} was not found for Candidate {candidate.id}."
            )
        if previous.evidence_type != normalized_type:
            raise CandidateEvidenceValidationError(
                "Candidate Evidence supersession must use the same evidence type as its predecessor"
            )

    observed_time = _utc(observed_at)
    evaluated_time = _utc(evaluated_at)
    event_time = _utc(event_at) if event_at is not None else None
    normalized_tier = data_tier.strip().lower()
    resolved_expected_delay = expected_delay_seconds
    if resolved_expected_delay is None and normalized_tier in {"delayed_consolidated", "delayed_sip"}:
        resolved_expected_delay = DEFAULT_DELAYED_CONSOLIDATED_DELAY_SECONDS
    assessment = evaluate_freshness(
        evidence_type=normalized_type,
        data_tier=normalized_tier,
        event_at=event_time,
        observed_at=observed_time,
        evaluated_at=evaluated_time,
    )
    evidence = CandidateEvidence(
        candidate_id=candidate.id,
        evidence_type=normalized_type,
        value_state=value_state,
        normalized_value=normalized_value,
        source_reference=source_reference.strip(),
        event_at=event_time,
        observed_at=observed_time,
        data_tier=normalized_tier,
        expected_delay_seconds=resolved_expected_delay,
        freshness_policy_version=assessment.policy_version,
        freshness_result=assessment.result,
        freshness_reason=assessment.reason,
        event_age_seconds=assessment.event_age_seconds,
        observation_age_seconds=assessment.observation_age_seconds,
        freshness_evaluated_at=evaluated_time,
        supersedes_evidence_id=supersedes_evidence_id,
        supersession_type=supersession_type,
    )
    db.add(evidence)
    db.flush()
    return evidence


def append_discovery_evidence(
    db: Session,
    *,
    candidate: ScannerSessionCandidate,
    source: str,
    source_reference: str,
    ticker: str,
    discovery_reason: str,
    provenance: dict[str, Any],
    observed_at: datetime,
    evaluated_at: datetime,
) -> CandidateEvidence:
    """Translate an admitted Discovery Hit into immutable Candidate Evidence."""

    data_tier = _data_tier_for_source(source, provenance)
    return append_candidate_evidence(
        db,
        candidate=candidate,
        evidence_type="market_movement",
        value_state="known",
        normalized_value={
            "ticker": ticker,
            "discovery_reason": discovery_reason,
        },
        source_reference=source_reference,
        event_at=_provider_event_at(provenance),
        observed_at=observed_at,
        data_tier=data_tier,
        expected_delay_seconds=_expected_delay(provenance, data_tier),
        evaluated_at=evaluated_at,
    )


def supports_current_positive(
    evidence: CandidateEvidence,
    *,
    superseded: bool = False,
    evaluated_at: datetime | None = None,
) -> bool:
    """Only currently fresh, known, current evidence may support a positive conclusion.

    The persisted freshness fields describe the assessment made when this row
    was appended. Current support is reevaluated at the decision boundary so a
    formerly fresh observation cannot remain eligible forever.
    """

    if superseded or evidence.value_state != "known":
        return False
    assessment = evaluate_freshness(
        evidence_type=evidence.evidence_type,
        data_tier=evidence.data_tier,
        event_at=evidence.event_at,
        observed_at=evidence.observed_at,
        evaluated_at=evaluated_at or datetime.now(timezone.utc),
        policy_version=evidence.freshness_policy_version,
    )
    return assessment.result == "fresh"
