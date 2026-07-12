from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://trading:trading@localhost:5432/trading_tool"
    redis_url: str = "redis://localhost:6379/0"
    cors_origins: str = "http://localhost:3000"
    sample_data_path: str = "data/sample_scanner_data.csv"
    alpaca_api_key_id: str = ""
    alpaca_api_secret_key: str = ""
    alpaca_trading_base_url: str = "https://paper-api.alpaca.markets"
    alpaca_trade_stream_url: str = "wss://paper-api.alpaca.markets/stream"
    alpaca_data_base_url: str = "https://data.alpaca.markets"
    alpaca_scanner_feed: Literal["delayed_sip", "iex", "sip"] = "delayed_sip"
    alpaca_execution_feed: Literal["iex", "sip"] = "iex"
    sec_user_agent: str = ""
    automation_poll_seconds: int = 5
    broker_stream_reconnect_min_seconds: float = 1.0
    broker_stream_reconnect_max_seconds: float = 30.0
    automation_quote_max_age_seconds: int = 60
    automation_max_price_deviation_pct: float = 2.0
    allow_live_trading: bool = False

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def alpaca_configured(self) -> bool:
        return bool(self.alpaca_api_key_id.strip() and self.alpaca_api_secret_key.strip())

    @property
    def sec_configured(self) -> bool:
        from app.providers.sec_edgar import validate_sec_user_agent

        try:
            validate_sec_user_agent(self.sec_user_agent)
        except ValueError:
            return False
        return True

    @property
    def alpaca_paper_mode(self) -> bool:
        return self.alpaca_trading_base_url.strip().rstrip("/").lower() == "https://paper-api.alpaca.markets"

    @property
    def alpaca_paper_stream_mode(self) -> bool:
        return self.alpaca_trade_stream_url.strip().rstrip("/").lower() == "wss://paper-api.alpaca.markets/stream"


@lru_cache
def get_settings() -> Settings:
    return Settings()
