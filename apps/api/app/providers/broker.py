"""Provider-neutral broker contracts.

The application owns these records.  Broker-specific payloads and naming stop
at this module so another execution venue can implement the same protocol
without changing risk or automation services.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Mapping, Optional, Protocol, Sequence, Tuple, runtime_checkable


class BrokerProviderError(RuntimeError):
    """Base error raised by a broker adapter without leaking credentials."""

    def __init__(
        self,
        message: str,
        *,
        request_id: Optional[str] = None,
        status_code: Optional[int] = None,
        provider_code: Optional[str] = None,
    ) -> None:
        self.message = message
        self.request_id = request_id
        self.status_code = status_code
        self.provider_code = provider_code
        suffix = f" [request_id={request_id}]" if request_id else ""
        super().__init__(f"{message}{suffix}")


class BrokerConfigurationError(BrokerProviderError):
    """Raised when a broker is configured in an unsafe or unusable way."""


class BrokerAuthenticationError(BrokerProviderError):
    """Raised when the provider rejects configured credentials."""


class BrokerRequestError(BrokerProviderError):
    """Raised when a provider request fails outside a normal order rejection."""


class BrokerOrderRejectedError(BrokerProviderError):
    """Raised when the provider explicitly rejects an order operation."""


class BrokerNotFoundError(BrokerProviderError):
    """Raised when a requested broker resource does not exist."""


class BrokerPayloadError(BrokerProviderError):
    """Raised when a successful provider response cannot be normalized."""


class BrokerTransportError(BrokerProviderError):
    """Raised when no conclusive HTTP response is received.

    ``outcome_unknown`` is true for mutations because the provider may have
    accepted them before the connection failed.  Callers must reconcile by
    deterministic client order ID and must not blindly retry.
    """

    def __init__(self, message: str, *, outcome_unknown: bool) -> None:
        self.outcome_unknown = outcome_unknown
        super().__init__(message)


@dataclass(frozen=True)
class BrokerAccount:
    id: str
    status: str
    account_number: Optional[str]
    currency: Optional[str]
    cash: Optional[Decimal]
    equity: Optional[Decimal]
    buying_power: Optional[Decimal]
    non_marginable_buying_power: Optional[Decimal]
    portfolio_value: Optional[Decimal]
    multiplier: Optional[Decimal]
    shorting_enabled: bool
    account_blocked: bool
    trading_blocked: bool
    trade_suspended_by_user: bool
    created_at: Optional[datetime]
    request_id: Optional[str] = None


@dataclass(frozen=True)
class BrokerClock:
    timestamp: datetime
    is_open: bool
    next_open: datetime
    next_close: datetime
    request_id: Optional[str] = None


@dataclass(frozen=True)
class BrokerPosition:
    symbol: str
    side: str
    quantity: Decimal
    quantity_available: Optional[Decimal]
    average_entry_price: Optional[Decimal]
    market_value: Optional[Decimal]
    cost_basis: Optional[Decimal]
    current_price: Optional[Decimal]
    unrealized_profit_loss: Optional[Decimal]
    unrealized_profit_loss_percent: Optional[Decimal]
    unrealized_intraday_profit_loss: Optional[Decimal]
    unrealized_intraday_profit_loss_percent: Optional[Decimal]
    asset_id: Optional[str] = None
    asset_class: Optional[str] = None
    exchange: Optional[str] = None


@dataclass(frozen=True)
class BrokerPositionList:
    positions: Tuple[BrokerPosition, ...]
    request_id: Optional[str] = None


@dataclass(frozen=True)
class BrokerOrder:
    id: str
    client_order_id: str
    symbol: str
    side: str
    order_type: str
    time_in_force: str
    order_class: str
    status: str
    quantity: Optional[Decimal]
    notional: Optional[Decimal]
    filled_quantity: Decimal
    filled_average_price: Optional[Decimal]
    limit_price: Optional[Decimal]
    stop_price: Optional[Decimal]
    created_at: Optional[datetime]
    submitted_at: Optional[datetime]
    updated_at: Optional[datetime]
    filled_at: Optional[datetime]
    canceled_at: Optional[datetime]
    expired_at: Optional[datetime]
    failed_at: Optional[datetime]
    replaces: Optional[str]
    replaced_by: Optional[str]
    legs: Tuple["BrokerOrder", ...] = ()
    request_id: Optional[str] = None


@dataclass(frozen=True)
class BrokerOrderList:
    orders: Tuple[BrokerOrder, ...]
    request_id: Optional[str] = None


@dataclass(frozen=True)
class BrokerTradeUpdate:
    provider: str
    provider_event_id: str
    stream: str
    event_type: str
    order: BrokerOrder
    occurred_at: datetime
    received_at: datetime
    execution_id: Optional[str] = None
    price: Optional[Decimal] = None
    quantity: Optional[Decimal] = None
    position_quantity: Optional[Decimal] = None
    raw_data: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class BrokerCancellation:
    order_id: str
    accepted: bool
    request_id: Optional[str] = None


@dataclass(frozen=True)
class BrokerOrderRequest:
    """A provider-neutral, protected equity entry order.

    The first adapter intentionally supports only limit entries with either a
    bracket (take profit plus stop loss) or OTO (exactly one exit) protection.
    A client order ID is mandatory; the adapter never invents one.
    """

    symbol: str
    quantity: Decimal
    side: str
    limit_price: Decimal
    time_in_force: str
    client_order_id: str
    order_class: str = "bracket"
    take_profit_limit_price: Optional[Decimal] = None
    stop_loss_stop_price: Optional[Decimal] = None
    stop_loss_limit_price: Optional[Decimal] = None

    def __post_init__(self) -> None:
        symbol = str(self.symbol).strip().upper()
        if not symbol:
            raise ValueError("symbol must not be blank.")
        client_order_id = str(self.client_order_id).strip()
        if not client_order_id:
            raise ValueError("client_order_id is required; it must be deterministic.")
        if len(client_order_id) > 128:
            raise ValueError("client_order_id must be at most 128 characters.")

        side = str(self.side).strip().lower()
        if side not in {"buy", "sell"}:
            raise ValueError("side must be 'buy' or 'sell'.")
        time_in_force = str(self.time_in_force).strip().lower()
        if time_in_force not in {"day", "gtc"}:
            raise ValueError("Protected limit orders require time_in_force 'day' or 'gtc'.")
        order_class = str(self.order_class).strip().lower()
        if order_class not in {"bracket", "oto"}:
            raise ValueError("order_class must be 'bracket' or 'oto'.")

        quantity = _positive_decimal(self.quantity, "quantity")
        limit_price = _positive_decimal(self.limit_price, "limit_price")
        take_profit = _optional_positive_decimal(
            self.take_profit_limit_price,
            "take_profit_limit_price",
        )
        stop_price = _optional_positive_decimal(
            self.stop_loss_stop_price,
            "stop_loss_stop_price",
        )
        stop_limit = _optional_positive_decimal(
            self.stop_loss_limit_price,
            "stop_loss_limit_price",
        )

        if stop_limit is not None and stop_price is None:
            raise ValueError("stop_loss_limit_price requires stop_loss_stop_price.")
        if order_class == "bracket" and (take_profit is None or stop_price is None):
            raise ValueError("A bracket order requires take-profit and stop-loss prices.")
        if order_class == "oto" and (take_profit is None) == (stop_price is None):
            raise ValueError("An OTO order requires exactly one take-profit or stop-loss exit.")
        if take_profit is not None and stop_price is not None:
            if side == "buy" and take_profit <= stop_price:
                raise ValueError("A buy bracket take-profit must be above its stop price.")
            if side == "sell" and take_profit >= stop_price:
                raise ValueError("A sell bracket take-profit must be below its stop price.")

        object.__setattr__(self, "symbol", symbol)
        object.__setattr__(self, "client_order_id", client_order_id)
        object.__setattr__(self, "side", side)
        object.__setattr__(self, "time_in_force", time_in_force)
        object.__setattr__(self, "order_class", order_class)
        object.__setattr__(self, "quantity", quantity)
        object.__setattr__(self, "limit_price", limit_price)
        object.__setattr__(self, "take_profit_limit_price", take_profit)
        object.__setattr__(self, "stop_loss_stop_price", stop_price)
        object.__setattr__(self, "stop_loss_limit_price", stop_limit)


def _positive_decimal(value: Any, name: str) -> Decimal:
    try:
        normalized = value if isinstance(value, Decimal) else Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a decimal number.") from exc
    if not normalized.is_finite() or normalized <= 0:
        raise ValueError(f"{name} must be greater than zero.")
    return normalized


def _optional_positive_decimal(value: Any, name: str) -> Optional[Decimal]:
    if value is None or value == "":
        return None
    return _positive_decimal(value, name)


@runtime_checkable
class BrokerProvider(Protocol):
    @property
    def provider_name(self) -> str:
        ...

    @property
    def paper_trading(self) -> bool:
        ...

    async def get_account(self) -> BrokerAccount:
        ...

    async def get_clock(self) -> BrokerClock:
        ...

    async def list_positions(self) -> BrokerPositionList:
        ...

    async def list_orders(
        self,
        *,
        status: str = "open",
        limit: int = 50,
        nested: bool = True,
        symbols: Sequence[str] = (),
        after: Optional[datetime] = None,
        until: Optional[datetime] = None,
        direction: str = "desc",
    ) -> BrokerOrderList:
        ...

    async def get_order_by_client_id(self, client_order_id: str) -> BrokerOrder:
        ...

    async def get_order(self, order_id: str, *, nested: bool = True) -> BrokerOrder:
        ...

    async def submit_order(self, request: BrokerOrderRequest) -> BrokerOrder:
        ...

    async def cancel_order(self, order_id: str) -> BrokerCancellation:
        ...

    async def aclose(self) -> None:
        ...
