from __future__ import annotations

from dataclasses import dataclass

from app.core.config import Settings
from app.providers.alpaca_broker import AlpacaBrokerProvider
from app.providers.broker import BrokerAccount, BrokerClock, BrokerOrder, BrokerPosition


class BrokerNotConfigured(RuntimeError):
    pass


class UnsafeBrokerConfiguration(RuntimeError):
    pass


@dataclass(frozen=True)
class BrokerSync:
    account: BrokerAccount
    clock: BrokerClock
    positions: tuple[BrokerPosition, ...]
    orders: tuple[BrokerOrder, ...]


def create_broker(settings: Settings) -> AlpacaBrokerProvider:
    if not settings.alpaca_configured:
        raise BrokerNotConfigured("Alpaca paper credentials are not configured.")
    if not settings.alpaca_paper_mode or settings.allow_live_trading:
        raise UnsafeBrokerConfiguration(
            "This release only permits the exact Alpaca paper endpoint with live trading disabled."
        )
    return AlpacaBrokerProvider(
        settings.alpaca_api_key_id,
        settings.alpaca_api_secret_key,
        base_url=settings.alpaca_trading_base_url,
        allow_live=False,
    )


async def sync_broker(settings: Settings) -> BrokerSync:
    broker = create_broker(settings)
    try:
        account = await broker.get_account()
        clock = await broker.get_clock()
        positions = await broker.list_positions()
        orders = await broker.list_orders(status="all", limit=100, nested=True)
        return BrokerSync(
            account=account,
            clock=clock,
            positions=positions.positions,
            orders=orders.orders,
        )
    finally:
        await broker.aclose()
