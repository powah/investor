import asyncio
import json
from datetime import timezone
from decimal import Decimal

import httpx
import pytest

from app.providers.alpaca_broker import (
    ALPACA_LIVE_TRADING_BASE_URL,
    ALPACA_PAPER_TRADING_BASE_URL,
    AlpacaBrokerProvider,
)
from app.providers.broker import (
    BrokerAuthenticationError,
    BrokerConfigurationError,
    BrokerPayloadError,
    BrokerOrderRejectedError,
    BrokerOrderRequest,
    BrokerTransportError,
)


def _order_payload(**overrides):
    payload = {
        "id": "order-1",
        "client_order_id": "plan-17-entry-v1",
        "symbol": "AAPL",
        "asset_class": "us_equity",
        "side": "buy",
        "type": "limit",
        "time_in_force": "day",
        "order_class": "bracket",
        "status": "accepted",
        "qty": "2.50",
        "notional": None,
        "filled_qty": "0",
        "filled_avg_price": None,
        "limit_price": "190.25",
        "stop_price": None,
        "created_at": "2026-07-11T10:00:00.123456789Z",
        "submitted_at": "2026-07-11T10:00:01Z",
        "updated_at": "2026-07-11T10:00:01Z",
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


def test_read_methods_authenticate_and_normalize_provider_payloads():
    paths = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        assert request.headers["APCA-API-KEY-ID"] == "paper-key"
        assert request.headers["APCA-API-SECRET-KEY"] == "paper-secret"
        assert request.headers["Accept"] == "application/json"
        if request.url.path == "/v2/account":
            return httpx.Response(
                200,
                headers={"X-Request-ID": "req-account"},
                json={
                    "id": "account-1",
                    "account_number": "PA123",
                    "status": "ACTIVE",
                    "currency": "USD",
                    "cash": "10000.50",
                    "equity": "12500.75",
                    "buying_power": "20001.00",
                    "non_marginable_buying_power": "9999.25",
                    "portfolio_value": "12500.75",
                    "multiplier": "2",
                    "shorting_enabled": True,
                    "account_blocked": False,
                    "trading_blocked": False,
                    "trade_suspended_by_user": False,
                    "created_at": "2026-01-01T12:00:00Z",
                },
            )
        if request.url.path == "/v2/clock":
            return httpx.Response(
                200,
                headers={"X-Request-ID": "req-clock"},
                json={
                    "timestamp": "2026-07-11T10:00:00-04:00",
                    "is_open": True,
                    "next_open": "2026-07-13T09:30:00-04:00",
                    "next_close": "2026-07-11T16:00:00-04:00",
                },
            )
        if request.url.path == "/v2/positions":
            return httpx.Response(
                200,
                headers={"X-Request-ID": "req-positions"},
                json=[
                    {
                        "asset_id": "asset-aapl",
                        "symbol": "aapl",
                        "asset_class": "us_equity",
                        "exchange": "NASDAQ",
                        "side": "long",
                        "qty": "2.5",
                        "qty_available": "1.5",
                        "avg_entry_price": "180.10",
                        "market_value": "475.625",
                        "cost_basis": "450.25",
                        "current_price": "190.25",
                        "unrealized_pl": "25.375",
                        "unrealized_plpc": "0.05636",
                        "unrealized_intraday_pl": "2.5",
                        "unrealized_intraday_plpc": "0.00528",
                    }
                ],
            )
        if request.url.path == "/v2/orders":
            assert request.url.params["status"] == "open"
            assert request.url.params["limit"] == "25"
            assert request.url.params["nested"] == "true"
            assert request.url.params["symbols"] == "AAPL,MSFT"
            return httpx.Response(
                200,
                headers={"X-Request-ID": "req-orders"},
                json=[_order_payload()],
            )
        raise AssertionError(f"Unexpected request: {request.url}")

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = AlpacaBrokerProvider(" paper-key ", " paper-secret ", client=client)
            account = await provider.get_account()
            clock = await provider.get_clock()
            positions = await provider.list_positions()
            orders = await provider.list_orders(limit=25, symbols=("aapl", "MSFT", "AAPL"))
            return provider, account, clock, positions, orders

    provider, account, clock, positions, orders = asyncio.run(scenario())

    assert provider.paper_trading is True
    assert account.cash == Decimal("10000.50")
    assert account.buying_power == Decimal("20001.00")
    assert account.request_id == "req-account"
    assert clock.timestamp.tzinfo == timezone.utc
    assert clock.timestamp.isoformat() == "2026-07-11T14:00:00+00:00"
    assert clock.request_id == "req-clock"
    assert positions.request_id == "req-positions"
    assert positions.positions[0].symbol == "AAPL"
    assert positions.positions[0].quantity_available == Decimal("1.5")
    assert orders.request_id == "req-orders"
    assert orders.orders[0].quantity == Decimal("2.50")
    assert orders.orders[0].created_at.microsecond == 123456
    assert paths == ["/v2/account", "/v2/clock", "/v2/positions", "/v2/orders"]


def test_multileg_parent_allows_blank_aggregate_symbol_and_side():
    parent = _order_payload(
        id="mleg-parent",
        client_order_id="mleg-parent-v1",
        symbol="",
        side="",
        order_class="mleg",
        qty=None,
        limit_price=None,
        legs=[
            _order_payload(
                id="mleg-leg-1",
                client_order_id="mleg-leg-1-v1",
                symbol="AAPL260717C00200000",
                side="buy",
                order_class="simple",
                qty="1",
            ),
            _order_payload(
                id="mleg-leg-2",
                client_order_id="mleg-leg-2-v1",
                symbol="AAPL260717C00210000",
                side="sell",
                order_class="simple",
                qty="1",
            ),
        ],
    )

    async def scenario():
        transport = httpx.MockTransport(lambda request: httpx.Response(200, json=[parent]))
        async with httpx.AsyncClient(transport=transport) as client:
            provider = AlpacaBrokerProvider("key", "secret", client=client)
            return await provider.list_orders(status="all", nested=True)

    orders = asyncio.run(scenario())

    normalized = orders.orders[0]
    assert normalized.order_class == "mleg"
    assert normalized.symbol == ""
    assert normalized.side == ""
    assert [(leg.symbol, leg.side) for leg in normalized.legs] == [
        ("AAPL260717C00200000", "buy"),
        ("AAPL260717C00210000", "sell"),
    ]


def test_simple_order_still_rejects_blank_symbol_or_side():
    async def scenario():
        transport = httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                headers={"X-Request-ID": "req-invalid-order"},
                json=[_order_payload(symbol="")],
            )
        )
        async with httpx.AsyncClient(transport=transport) as client:
            provider = AlpacaBrokerProvider("key", "secret", client=client)
            return await provider.list_orders()

    with pytest.raises(BrokerPayloadError, match="invalid order") as captured:
        asyncio.run(scenario())

    assert captured.value.request_id == "req-invalid-order"


def test_submit_bracket_payload_and_cancel_are_explicit_single_requests():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path))
        if request.method == "POST":
            assert request.headers["Content-Type"] == "application/json"
            assert json.loads(request.content) == {
                "symbol": "AAPL",
                "qty": "2.5",
                "side": "buy",
                "type": "limit",
                "time_in_force": "day",
                "limit_price": "190.25",
                "client_order_id": "plan-17-entry-v1",
                "order_class": "bracket",
                "extended_hours": False,
                "take_profit": {"limit_price": "205"},
                "stop_loss": {"stop_price": "184", "limit_price": "183.5"},
            }
            return httpx.Response(
                200,
                headers={"X-Request-ID": "req-submit"},
                json=_order_payload(),
            )
        assert request.method == "DELETE"
        assert request.url.path == "/v2/orders/order-1"
        return httpx.Response(204, headers={"X-Request-ID": "req-cancel"})

    request = BrokerOrderRequest(
        symbol="aapl",
        quantity=Decimal("2.500"),
        side="BUY",
        limit_price=Decimal("190.250"),
        time_in_force="day",
        client_order_id="plan-17-entry-v1",
        order_class="bracket",
        take_profit_limit_price=Decimal("205"),
        stop_loss_stop_price=Decimal("184"),
        stop_loss_limit_price=Decimal("183.50"),
    )

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = AlpacaBrokerProvider("key", "secret", client=client)
            order = await provider.submit_order(request)
            cancellation = await provider.cancel_order(order.id)
            return order, cancellation

    order, cancellation = asyncio.run(scenario())

    assert order.request_id == "req-submit"
    assert cancellation.accepted is True
    assert cancellation.request_id == "req-cancel"
    assert calls == [("POST", "/v2/orders"), ("DELETE", "/v2/orders/order-1")]


def test_submit_oto_payload_has_exactly_one_exit():
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert payload["order_class"] == "oto"
        assert payload["stop_loss"] == {"stop_price": "184"}
        assert "take_profit" not in payload
        return httpx.Response(200, json=_order_payload(order_class="oto"))

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = AlpacaBrokerProvider("key", "secret", client=client)
            return await provider.submit_order(
                BrokerOrderRequest(
                    symbol="AAPL",
                    quantity=Decimal("1"),
                    side="buy",
                    limit_price=Decimal("190"),
                    time_in_force="gtc",
                    client_order_id="plan-18-entry-v1",
                    order_class="oto",
                    stop_loss_stop_price=Decimal("184"),
                )
            )

    order = asyncio.run(scenario())
    assert order.order_class == "oto"


def test_live_and_non_alpaca_urls_fail_closed():
    with pytest.raises(BrokerConfigurationError, match="Live Alpaca trading is disabled"):
        AlpacaBrokerProvider(
            "key",
            "secret",
            base_url=ALPACA_LIVE_TRADING_BASE_URL,
        )
    with pytest.raises(BrokerConfigurationError, match="official paper endpoint"):
        AlpacaBrokerProvider(
            "key",
            "secret",
            base_url="https://paper-api.alpaca.markets.evil.example",
            allow_live=True,
        )

    provider = AlpacaBrokerProvider(
        "key",
        "secret",
        base_url=ALPACA_LIVE_TRADING_BASE_URL,
        allow_live=True,
    )
    assert provider.paper_trading is False
    asyncio.run(provider.aclose())
    assert ALPACA_PAPER_TRADING_BASE_URL == "https://paper-api.alpaca.markets"


def test_order_rejection_surfaces_request_id_and_is_never_retried():
    call_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        return httpx.Response(
            422,
            headers={"X-Request-ID": "req-reject"},
            json={"code": 42210000, "message": "insufficient buying power"},
        )

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = AlpacaBrokerProvider("key", "secret", client=client)
            with pytest.raises(BrokerOrderRejectedError) as captured:
                await provider.submit_order(
                    BrokerOrderRequest(
                        symbol="AAPL",
                        quantity=Decimal("1"),
                        side="buy",
                        limit_price=Decimal("190"),
                        time_in_force="day",
                        client_order_id="plan-rejected-v1",
                        order_class="oto",
                        stop_loss_stop_price=Decimal("184"),
                    )
                )
            return captured.value

    error = asyncio.run(scenario())

    assert error.status_code == 422
    assert error.provider_code == "42210000"
    assert error.request_id == "req-reject"
    assert "req-reject" in str(error)
    assert call_count == 1


def test_lookup_by_deterministic_client_order_id_and_auth_failure():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url)
        if request.url.params.get("client_order_id") == "plan-17-entry-v1":
            return httpx.Response(
                200,
                headers={"X-Request-ID": "req-lookup"},
                json=_order_payload(status="partially_filled", filled_qty="1.25"),
            )
        return httpx.Response(
            401,
            headers={"X-Request-ID": "req-auth"},
            json={"message": "unauthorized"},
        )

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = AlpacaBrokerProvider("key", "secret", client=client)
            order = await provider.get_order_by_client_id("plan-17-entry-v1")
            with pytest.raises(BrokerAuthenticationError) as captured:
                await provider.get_order_by_client_id("missing")
            return order, captured.value

    order, error = asyncio.run(scenario())

    assert calls[0].path == "/v2/orders:by_client_order_id"
    assert order.status == "partially_filled"
    assert order.filled_quantity == Decimal("1.25")
    assert order.request_id == "req-lookup"
    assert error.request_id == "req-auth"


def test_get_order_by_id_requests_nested_protective_legs():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v2/orders/order-1"
        assert request.url.params["nested"] == "true"
        return httpx.Response(
            200,
            headers={"X-Request-ID": "req-nested"},
            json=_order_payload(
                status="filled",
                legs=[
                    _order_payload(
                        id="stop-leg-1",
                        client_order_id="plan-17-stop-v1",
                        side="sell",
                        type="stop",
                        order_class="simple",
                        status="held",
                        stop_price="184",
                        limit_price=None,
                    )
                ],
            ),
        )

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = AlpacaBrokerProvider("key", "secret", client=client)
            return await provider.get_order("order-1", nested=True)

    order = asyncio.run(scenario())

    assert order.request_id == "req-nested"
    assert order.legs[0].id == "stop-leg-1"
    assert order.legs[0].status == "held"


def test_ambiguous_submit_transport_error_requires_reconciliation_without_retry():
    call_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        raise httpx.ReadTimeout("timeout after request write", request=request)

    async def scenario():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            provider = AlpacaBrokerProvider("key", "secret", client=client)
            with pytest.raises(BrokerTransportError) as captured:
                await provider.submit_order(
                    BrokerOrderRequest(
                        symbol="AAPL",
                        quantity=Decimal("1"),
                        side="buy",
                        limit_price=Decimal("190"),
                        time_in_force="day",
                        client_order_id="plan-timeout-v1",
                        order_class="oto",
                        stop_loss_stop_price=Decimal("184"),
                    )
                )
            return captured.value

    error = asyncio.run(scenario())

    assert error.outcome_unknown is True
    assert "reconcile provider state" in str(error)
    assert call_count == 1
