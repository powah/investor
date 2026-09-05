from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
    func,
)
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
    discovery_hits: Mapped[list[DiscoveryHit]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="DiscoveryHit.id",
    )
    candidates: Mapped[list[ScannerSessionCandidate]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="ScannerSessionCandidate.id",
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


class Security(Base):
    __tablename__ = "securities"
    __table_args__ = (
        UniqueConstraint("identifier_source", "identifier", name="uq_securities_stable_identity"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    identifier_source: Mapped[str] = mapped_column(String(80), nullable=False)
    identifier: Mapped[str] = mapped_column(String(160), nullable=False)
    issuer_name: Mapped[Optional[str]] = mapped_column(String(240), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    listings: Mapped[list[Listing]] = relationship(back_populates="security")


class Listing(Base):
    __tablename__ = "listings"
    __table_args__ = (
        UniqueConstraint(
            "security_id",
            "ticker",
            "exchange",
            "effective_from",
            name="uq_listings_effective_identity",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    security_id: Mapped[int] = mapped_column(
        ForeignKey("securities.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    ticker: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    exchange: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    status: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    instrument_type: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    effective_from: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    effective_to: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    foreign_issuer: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    depositary_to_underlying_ratio: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    security: Mapped[Security] = relationship(back_populates="listings")


class ScannerSessionCandidate(Base):
    __tablename__ = "scanner_session_candidates"
    __table_args__ = (
        UniqueConstraint(
            "scanner_session_id", "security_id", name="uq_candidates_session_security"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scanner_session_id: Mapped[int] = mapped_column(
        ForeignKey("scanner_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    security_id: Mapped[int] = mapped_column(
        ForeignKey("securities.id", ondelete="RESTRICT"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    session: Mapped[ScannerSession] = relationship(back_populates="candidates")
    security: Mapped[Security] = relationship()
    discovery_hits: Mapped[list[DiscoveryHit]] = relationship(
        back_populates="candidate", order_by="DiscoveryHit.id"
    )


class DiscoveryHit(Base):
    __tablename__ = "discovery_hits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    scanner_session_id: Mapped[int] = mapped_column(
        ForeignKey("scanner_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    security_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("securities.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    listing_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("listings.id", ondelete="RESTRICT"), nullable=True
    )
    candidate_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("scanner_session_candidates.id", ondelete="SET NULL"), nullable=True, index=True
    )
    source: Mapped[str] = mapped_column(String(80), nullable=False)
    source_reference: Mapped[str] = mapped_column(String(500), nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ticker: Mapped[str] = mapped_column(String(24), nullable=False)
    observed_exchange: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    observed_listing_status: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    observed_instrument_type: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    observed_effective_from: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    observed_effective_to: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    observed_foreign_issuer: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    observed_depositary_to_underlying_ratio: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True
    )
    discovery_reason: Mapped[str] = mapped_column(Text, nullable=False)
    admission_outcome: Mapped[str] = mapped_column(String(20), nullable=False)
    admission_reasons: Mapped[list[str]] = mapped_column(JSON, nullable=False)

    session: Mapped[ScannerSession] = relationship(back_populates="discovery_hits")
    security: Mapped[Optional[Security]] = relationship()
    listing: Mapped[Optional[Listing]] = relationship()
    candidate: Mapped[Optional[ScannerSessionCandidate]] = relationship(
        back_populates="discovery_hits"
    )
