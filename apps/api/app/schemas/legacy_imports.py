from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel


class LegacyImportRead(BaseModel):
    id: int
    label: Literal["Legacy Import"] = "Legacy Import"
    reference_only: Literal[True] = True
    actionable: Literal[False] = False
    ticker: str
    price: float
    gap_pct: float
    rel_volume: float
    float_m: float
    market_cap_m: float
    spread_pct: float
    catalyst_type: Optional[str]
    above_vwap: bool
    news_headline: Optional[str]
    clean_daily_chart_room: bool
    holding_key_level: bool
    no_dilution_red_flag: bool
    legacy_status: str
    data_origin: str
    original_created_at: datetime
    original_updated_at: datetime
    source_provenance: Optional[str]
    trading_date: Optional[date]
    market_phase: Optional[str]
    source_timestamp: Optional[datetime]
