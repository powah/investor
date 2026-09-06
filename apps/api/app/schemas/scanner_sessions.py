from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.scanner_session_types import (
    MarketPhase,
    ScannerSessionDiagnosticStatus,
    ScannerSessionStage,
    ScannerSessionStatus,
)


MAX_SUPPLEMENTARY_INPUTS = 1000


class NormalizedDiscoveryHit(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    source: str = Field(min_length=1, max_length=80)
    source_reference: str = Field(min_length=1, max_length=500)
    observed_at: Optional[datetime] = None
    ticker: str = Field(min_length=1, max_length=24)
    discovery_reason: str = Field(min_length=1, max_length=500)
    provenance: dict[str, Any] = Field(default_factory=dict)
    security_identifier_source: Optional[str] = Field(default=None, max_length=80)
    security_identifier: Optional[str] = Field(default=None, max_length=160)
    issuer_name: Optional[str] = Field(default=None, max_length=240)
    exchange: Optional[str] = Field(default=None, max_length=40)
    listing_status: Optional[str] = Field(default=None, max_length=40)
    instrument_type: Optional[str] = Field(default=None, max_length=80)
    effective_from: Optional[date] = None
    effective_to: Optional[date] = None
    foreign_issuer: Optional[bool] = None
    depositary_to_underlying_ratio: Optional[float] = Field(
        default=None, gt=0, allow_inf_nan=False
    )

    @field_validator("observed_at")
    @classmethod
    def observed_at_must_include_timezone(cls, value: Optional[datetime]) -> Optional[datetime]:
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("observed_at must include a timezone")
        return value


class SupplementaryDiscoveryInput(NormalizedDiscoveryHit):
    source: Literal["manual", "csv"] = "manual"


class ScannerSessionStart(BaseModel):
    supplementary_inputs: list[SupplementaryDiscoveryInput] = Field(
        default_factory=list, max_length=MAX_SUPPLEMENTARY_INPUTS
    )


class SecurityRead(BaseModel):
    id: int
    identifier_source: str
    identifier: str
    issuer_name: Optional[str]


class ListingRead(BaseModel):
    id: int
    security_id: int
    ticker: str
    exchange: Optional[str]
    status: Optional[str]
    instrument_type: Optional[str]
    effective_from: Optional[date]
    effective_to: Optional[date]
    foreign_issuer: Optional[bool]
    depositary_to_underlying_ratio: Optional[float]


class ListingObservationRead(BaseModel):
    ticker: str
    exchange: Optional[str]
    status: Optional[str]
    instrument_type: Optional[str]
    effective_from: Optional[date]
    effective_to: Optional[date]
    foreign_issuer: Optional[bool]
    depositary_to_underlying_ratio: Optional[float]


class DiscoveryHitRead(BaseModel):
    id: int
    source: str
    source_reference: str
    observed_at: datetime
    ticker: str
    discovery_reason: str
    provenance: dict[str, Any] = Field(default_factory=dict)
    observed_listing: ListingObservationRead
    admission_outcome: Literal["admitted", "rejected", "unresolved"]
    admission_reasons: list[str]
    security: Optional[SecurityRead]
    listing: Optional[ListingRead]
    candidate_id: Optional[int]


class CandidateRead(BaseModel):
    id: int
    security: SecurityRead
    observed_listings: list[ListingRead]
    discovery_hit_ids: list[int]
    discovery_sources: list[str]
    discovery_reasons: list[str]


class ScannerSessionProgressRead(BaseModel):
    completed: int
    total: int
    percent: int


class ScannerSessionDiagnosticRead(BaseModel):
    source: str
    capability: str
    required: bool
    status: ScannerSessionDiagnosticStatus
    records_count: int
    code: Optional[str]
    message: Optional[str]
    details: dict[str, Any]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]


class ScannerSessionSummaryRead(BaseModel):
    id: int
    status: ScannerSessionStatus
    stage: ScannerSessionStage
    started_at: datetime
    completed_at: Optional[datetime]
    trading_date: date
    market_phase: MarketPhase
    scanner_policy_version: str
    scoring_model_version: str
    progress: ScannerSessionProgressRead
    diagnostics_count: int
    discovery_hits_count: int
    candidates_count: int


class ScannerSessionRead(BaseModel):
    id: int
    status: ScannerSessionStatus
    stage: ScannerSessionStage
    started_at: datetime
    completed_at: Optional[datetime]
    trading_date: date
    market_phase: MarketPhase
    scanner_policy_version: str
    scanner_policy_settings: dict[str, Any]
    scoring_model_version: str
    progress: ScannerSessionProgressRead
    diagnostics: list[ScannerSessionDiagnosticRead]
    discovery_hits: list[DiscoveryHitRead]
    candidates: list[CandidateRead]
