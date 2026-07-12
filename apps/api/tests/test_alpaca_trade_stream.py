import asyncio
import json
from decimal import Decimal

import pytest

from app.providers.alpaca_trade_stream import (
    ALPACA_PAPER_TRADE_STREAM_URL,
    AlpacaTradeUpdateStream,
)
from app.providers.broker import BrokerAuthenticationError, BrokerConfigurationError


def _order_payload(**overrides):
    payload = {
        "id": "order-1",
        "client_order_id": "plan-17-entry-v1",
        "symbol": "AAPL",
        "side": "buy",
        "type": "limit",
        "time_in_force": "day",
        "order_class": "bracket",
        "status": "partially_filled",
        "qty": "2",
        "notional": None,
        "filled_qty": "1",
        "filled_avg_price": "190.25",
        "limit_price": "191",
        "stop_price": None,
        "created_at": "2026-07-12T10:00:00Z",
        "submitted_at": "2026-07-12T10:00:01Z",
        "updated_at": "2026-07-12T10:01:00Z",
        "filled_at": None,
        "canceled_at": None,
        "expired_at": None,
        "failed_at": None,
        "replaces": None,
        "replaced_by": None,
        "legs": None,
    }
    payload.update(overrides)
    return payload


class FakeConnection:
    def __init__(self, frames):
        self.frames = list(frames)
        self.sent = []
        self.closed = False

    async def send(self, value):
        self.sent.append(json.loads(value))

    async def recv(self):
        return self.frames.pop(0)

    async def close(self):
        self.closed = True


def test_stream_authenticates_subscribes_and_normalizes_binary_trade_update():
    connection = FakeConnection(
        [
            json.dumps({"stream": "authorization", "data": {"status": "authorized"}}),
            json.dumps({"stream": "listening", "data": {"streams": ["trade_updates"]}}),
            json.dumps(
                {
                    "stream": "trade_updates",
                    "data": {
                        "event": "partial_fill",
                        "execution_id": "execution-1",
                        "price": "190.25",
                        "qty": "1",
                        "position_qty": "1",
                        "timestamp": "2026-07-12T10:01:00Z",
                        "order": _order_payload(),
                    },
                }
            ).encode(),
        ]
    )

    async def connector(url, **kwargs):
        assert url == ALPACA_PAPER_TRADE_STREAM_URL
        assert kwargs["ping_interval"] == 20
        return connection

    async def scenario():
        stream = AlpacaTradeUpdateStream("key", "secret", connector=connector)
        await stream.connect()
        update = await stream.receive()
        await stream.aclose()
        return update

    update = asyncio.run(scenario())

    assert connection.sent == [
        {"action": "auth", "key": "key", "secret": "secret"},
        {"action": "listen", "data": {"streams": ["trade_updates"]}},
    ]
    assert update.provider_event_id == "alpaca:execution:execution-1:partial_fill"
    assert update.order.status == "partially_filled"
    assert update.price == Decimal("190.25")
    assert connection.closed is True


def test_stream_rejects_unauthorized_credentials_and_nonpaper_url():
    connection = FakeConnection(
        [json.dumps({"stream": "authorization", "data": {"status": "unauthorized"}})]
    )

    async def connector(url, **kwargs):
        return connection

    async def scenario():
        stream = AlpacaTradeUpdateStream("key", "secret", connector=connector)
        await stream.connect()

    with pytest.raises(BrokerAuthenticationError):
        asyncio.run(scenario())
    assert connection.closed is True

    with pytest.raises(BrokerConfigurationError, match="exact Alpaca paper endpoint"):
        AlpacaTradeUpdateStream("key", "secret", url="wss://api.alpaca.markets/stream")
