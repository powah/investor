from typing import Literal


MarketPhase = Literal["premarket", "regular", "after_hours", "closed"]
ScannerSessionStatus = Literal["running", "completed", "partial", "failed", "cancelled"]
ScannerSessionStage = Literal[
    "starting",
    "market_movement_discovery",
    "completed",
    "partial",
    "failed",
    "cancelled",
]
ScannerSessionDiagnosticStatus = Literal[
    "pending",
    "running",
    "completed",
    "unavailable",
    "failed",
    "skipped",
]
