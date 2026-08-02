from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel

from app.scanner_session_types import (
    MarketPhase,
    ScannerSessionDiagnosticStatus,
    ScannerSessionStage,
    ScannerSessionStatus,
)


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
