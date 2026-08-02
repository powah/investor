from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.scanner_session_types import (
    MarketPhase,
    ScannerSessionDiagnosticStatus,
    ScannerSessionStage,
    ScannerSessionStatus,
)


class ScannerSession(Base):
    __tablename__ = "scanner_sessions"
    __table_args__ = (UniqueConstraint("active_slot", name="uq_scanner_sessions_active_slot"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    status: Mapped[ScannerSessionStatus] = mapped_column(String(20), nullable=False, index=True)
    stage: Mapped[ScannerSessionStage] = mapped_column(String(40), nullable=False)
    active_slot: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    owner_id: Mapped[str] = mapped_column(String(32), nullable=False)
    heartbeat_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    trading_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    market_phase: Mapped[MarketPhase] = mapped_column(String(20), nullable=False)
    scanner_policy_version: Mapped[str] = mapped_column(String(80), nullable=False)
    scanner_policy_settings: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    scoring_model_version: Mapped[str] = mapped_column(String(80), nullable=False)
    progress_completed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    progress_total: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    diagnostics: Mapped[list[ScannerSessionDiagnostic]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="ScannerSessionDiagnostic.id",
    )


class ScannerSessionDiagnostic(Base):
    __tablename__ = "scanner_session_diagnostics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scanner_session_id: Mapped[int] = mapped_column(
        ForeignKey("scanner_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    source: Mapped[str] = mapped_column(String(120), nullable=False)
    capability: Mapped[str] = mapped_column(String(80), nullable=False)
    required: Mapped[bool] = mapped_column(Boolean, nullable=False)
    status: Mapped[ScannerSessionDiagnosticStatus] = mapped_column(String(20), nullable=False)
    records_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    code: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    details: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    session: Mapped[ScannerSession] = relationship(back_populates="diagnostics")
