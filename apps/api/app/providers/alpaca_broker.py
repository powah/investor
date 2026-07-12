"""Provider-neutral Alpaca Trading API adapter.

This adapter is paper-only by default.  It performs exactly one HTTP request
per method invocation and deliberately has no automatic retry path for order
mutations whose outcome could be ambiguous.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Mapping, Optional, Sequence, Tuple
from urllib.parse import quote

import httpx

from app.providers._normalization import parse_datetime
from app.providers.broker import (
    BrokerAccount,
    BrokerAuthenticationError,
    BrokerCancellation,
    BrokerClock,
    BrokerConfigurationError,
    BrokerNotFoundError,
    BrokerOrder,
    BrokerOrderList,
    BrokerOrderRejectedError,
    BrokerOrderRequest,
    BrokerPayloadError,
    BrokerPosition,
    BrokerPositionList,
    BrokerRequestError,
    BrokerTransportError,
)


ALPACA_PAPER_TRADING_BASE_URL = "https://paper-api.alpaca.markets"
ALPACA_LIVE_TRADING_BASE_URL = "https://api.alpaca.markets"


class AlpacaBrokerProvider:
    """Async Alpaca REST broker implementing the normalized broker contract."""

    def __init__(
        self,
        api_key: str,
        api_secret: str,
        *,
        base_url: str = ALPACA_PAPER_TRADING_BASE_URL,
        allow_live: bool = False,
        client: Optional[httpx.AsyncClient] = None,
        timeout_seconds: float = 20.0,
    ) -> None:
        self._api_key = _required_configuration(api_key, "api_key")
        self._api_secret = _required_configuration(api_secret, "api_secret")
        self._base_url = _validated_base_url(base_url, allow_live=allow_live)
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=timeout_seconds)

    @property
    def provider_name(self) -> str:
        return "alpaca"

    @property
    def paper_trading(self) -> bool:
        return self._base_url == ALPACA_PAPER_TRADING_BASE_URL

    @property
    def _headers(self) -> Dict[str, str]:
        return {
            "APCA-API-KEY-ID": self._api_key,
            "APCA-API-SECRET-KEY": self._api_secret,
            "Accept": "application/json",
        }

    async def get_account(self) -> BrokerAccount:
        response = await self._request("GET", "/v2/account")
        payload = self._json_object(response, "account")
        return _normalize_account(payload, _request_id(response))

    async def get_clock(self) -> BrokerClock:
        response = await self._request("GET", "/v2/clock")
        payload = self._json_object(response, "clock")
        return _normalize_clock(payload, _request_id(response))

    async def list_positions(self) -> BrokerPositionList:
        response = await self._request("GET", "/v2/positions")
        payload = self._json_list(response, "positions")
        request_id = _request_id(response)
        try:
            positions = tuple(_normalize_position(item) for item in payload)
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise BrokerPayloadError(
                "Alpaca positions response contains an invalid position.",
                request_id=request_id,
            ) from exc
        return BrokerPositionList(positions=positions, request_id=request_id)

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
        normalized_status = str(status).strip().lower()
        if normalized_status not in {"open", "closed", "all"}:
            raise ValueError("status must be 'open', 'closed', or 'all'.")
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 500:
            raise ValueError("limit must be between 1 and 500.")
        normalized_symbols = _normalize_symbols(symbols)
        normalized_direction = str(direction).strip().lower()
        if normalized_direction not in {"asc", "desc"}:
            raise ValueError("direction must be 'asc' or 'desc'.")
        params: Dict[str, Any] = {
            "status": normalized_status,
            "limit": limit,
            "nested": str(bool(nested)).lower(),
            "direction": normalized_direction,
        }
        if normalized_symbols:
            params["symbols"] = ",".join(normalized_symbols)
        if after is not None:
            params["after"] = _format_query_datetime(after, "after")
        if until is not None:
            params["until"] = _format_query_datetime(until, "until")

        response = await self._request("GET", "/v2/orders", params=params)
        payload = self._json_list(response, "orders")
        request_id = _request_id(response)
        try:
            orders = tuple(_normalize_order(item, request_id=request_id) for item in payload)
        except (InvalidOperation, TypeError, ValueError) as exc:
            raise BrokerPayloadError(
                "Alpaca orders response contains an invalid order.",
                request_id=request_id,
            ) from exc
        return BrokerOrderList(orders=orders, request_id=request_id)

    async def get_order_by_client_id(self, client_order_id: str) -> BrokerOrder:
        normalized_id = _validate_client_order_id(client_order_id)
        response = await self._request(
            "GET",
            "/v2/orders:by_client_order_id",
            params={"client_order_id": normalized_id},
        )
        payload = self._json_object(response, "order")
        return _normalize_order_or_raise(payload, _request_id(response))

    async def get_order(self, order_id: str, *, nested: bool = True) -> BrokerOrder:
        normalized_id = str(order_id).strip()
        if not normalized_id:
            raise ValueError("order_id must not be blank.")
        response = await self._request(
            "GET",
            f"/v2/orders/{quote(normalized_id, safe='')}",
            params={"nested": str(bool(nested)).lower()},
        )
        payload = self._json_object(response, "order")
        return _normalize_order_or_raise(payload, _request_id(response))

    async def submit_order(self, request: BrokerOrderRequest) -> BrokerOrder:
        if not isinstance(request, BrokerOrderRequest):
            raise TypeError("request must be a BrokerOrderRequest.")
        payload: Dict[str, Any] = {
            "symbol": request.symbol,
            "qty": _format_decimal(request.quantity),
            "side": request.side,
            "type": "limit",
            "time_in_force": request.time_in_force,
            "limit_price": _format_decimal(request.limit_price),
            "client_order_id": request.client_order_id,
            "order_class": request.order_class,
            "extended_hours": False,
        }
        if request.take_profit_limit_price is not None:
            payload["take_profit"] = {
                "limit_price": _format_decimal(request.take_profit_limit_price),
            }
        if request.stop_loss_stop_price is not None:
            stop_loss = {
                "stop_price": _format_decimal(request.stop_loss_stop_price),
            }
            if request.stop_loss_limit_price is not None:
                stop_loss["limit_price"] = _format_decimal(request.stop_loss_limit_price)
            payload["stop_loss"] = stop_loss

        response = await self._request("POST", "/v2/orders", json_body=payload)
        normalized = self._json_object(response, "order")
        return _normalize_order_or_raise(normalized, _request_id(response))

    async def cancel_order(self, order_id: str) -> BrokerCancellation:
        normalized_id = str(order_id).strip()
        if not normalized_id:
            raise ValueError("order_id must not be blank.")
        encoded_id = quote(normalized_id, safe="")
        response = await self._request("DELETE", f"/v2/orders/{encoded_id}")
        return BrokerCancellation(
            order_id=normalized_id,
            accepted=True,
            request_id=_request_id(response),
        )

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Mapping[str, Any]] = None,
        json_body: Optional[Mapping[str, Any]] = None,
    ) -> httpx.Response:
        headers = self._headers
        if json_body is not None:
            headers["Content-Type"] = "application/json"
        try:
            response = await self._client.request(
                method,
                f"{self._base_url}{path}",
                params=params,
                json=json_body,
                headers=headers,
                follow_redirects=False,
            )
        except httpx.RequestError as exc:
            mutation = method.upper() in {"POST", "PATCH", "DELETE"}
            detail = (
                "The broker operation outcome is unknown; reconcile provider state before "
                "taking any further action."
                if mutation
                else "No broker response was received."
            )
            raise BrokerTransportError(detail, outcome_unknown=mutation) from exc

        if response.is_success:
            return response
        self._raise_provider_error(response, mutation=method.upper() != "GET")
        raise AssertionError("unreachable")

    @staticmethod
    def _raise_provider_error(response: httpx.Response, *, mutation: bool) -> None:
        request_id = _request_id(response)
        provider_code, provider_message = _provider_error_details(response)
        status_code = response.status_code
        detail = provider_message or f"Alpaca returned HTTP {status_code}."
        common = {
            "request_id": request_id,
            "status_code": status_code,
            "provider_code": provider_code,
        }
        if status_code == 401 or (status_code == 403 and not mutation):
            raise BrokerAuthenticationError("Alpaca authentication failed.", **common)
        if status_code == 404:
            raise BrokerNotFoundError(detail, **common)
        if mutation and status_code in {400, 403, 409, 422}:
            raise BrokerOrderRejectedError(detail, **common)
        raise BrokerRequestError(detail, **common)

    @staticmethod
    def _json_object(response: httpx.Response, resource: str) -> Mapping[str, Any]:
        request_id = _request_id(response)
        try:
            payload = response.json()
        except ValueError as exc:
            raise BrokerPayloadError(
                f"Alpaca {resource} response is not valid JSON.",
                request_id=request_id,
            ) from exc
        if not isinstance(payload, dict):
            raise BrokerPayloadError(
                f"Alpaca {resource} response must be an object.",
                request_id=request_id,
            )
        return payload

    @staticmethod
    def _json_list(response: httpx.Response, resource: str) -> Sequence[Mapping[str, Any]]:
        request_id = _request_id(response)
        try:
            payload = response.json()
        except ValueError as exc:
            raise BrokerPayloadError(
                f"Alpaca {resource} response is not valid JSON.",
                request_id=request_id,
            ) from exc
        if not isinstance(payload, list) or any(not isinstance(item, dict) for item in payload):
            raise BrokerPayloadError(
                f"Alpaca {resource} response must be an array of objects.",
                request_id=request_id,
            )
        return payload

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def __aenter__(self) -> "AlpacaBrokerProvider":
        return self

    async def __aexit__(self, exc_type, exc_value, traceback) -> None:
        await self.aclose()


def _required_configuration(value: str, name: str) -> str:
    normalized = str(value).strip()
    if not normalized:
        raise BrokerConfigurationError(f"{name} must not be blank.")
    return normalized


def _validated_base_url(base_url: str, *, allow_live: bool) -> str:
    normalized = str(base_url).strip().rstrip("/")
    if normalized == ALPACA_PAPER_TRADING_BASE_URL:
        return normalized
    if allow_live and normalized == ALPACA_LIVE_TRADING_BASE_URL:
        return normalized
    if normalized == ALPACA_LIVE_TRADING_BASE_URL:
        raise BrokerConfigurationError(
            "Live Alpaca trading is disabled; explicitly set allow_live=True to enable it."
        )
    raise BrokerConfigurationError(
        "Alpaca trading base URL must be the official paper endpoint"
        + (" or official live endpoint." if allow_live else ".")
    )


def _request_id(response: httpx.Response) -> Optional[str]:
    value = response.headers.get("X-Request-ID")
    return value.strip() if value and value.strip() else None


def _provider_error_details(response: httpx.Response) -> Tuple[Optional[str], Optional[str]]:
    try:
        payload = response.json()
    except ValueError:
        text = response.text.strip()
        return None, text[:1000] or None
    if not isinstance(payload, dict):
        return None, None
    raw_code = payload.get("code")
    raw_message = payload.get("message") or payload.get("error")
    code = str(raw_code) if raw_code is not None else None
    message = str(raw_message).strip()[:1000] if raw_message is not None else None
    return code, message or None


def _normalize_account(payload: Mapping[str, Any], request_id: Optional[str]) -> BrokerAccount:
    try:
        return BrokerAccount(
            id=_required_text(payload.get("id"), "id"),
            status=_required_text(payload.get("status"), "status").upper(),
            account_number=_optional_text(payload.get("account_number")),
            currency=_optional_text(payload.get("currency")),
            cash=_optional_decimal(payload.get("cash"), "cash"),
            equity=_optional_decimal(payload.get("equity"), "equity"),
            buying_power=_optional_decimal(payload.get("buying_power"), "buying_power"),
            non_marginable_buying_power=_optional_decimal(
                payload.get("non_marginable_buying_power"),
                "non_marginable_buying_power",
            ),
            portfolio_value=_optional_decimal(payload.get("portfolio_value"), "portfolio_value"),
            multiplier=_optional_decimal(payload.get("multiplier"), "multiplier"),
            shorting_enabled=_parse_bool(payload.get("shorting_enabled", False), "shorting_enabled"),
            account_blocked=_parse_bool(payload.get("account_blocked", False), "account_blocked"),
            trading_blocked=_parse_bool(payload.get("trading_blocked", False), "trading_blocked"),
            trade_suspended_by_user=_parse_bool(
                payload.get("trade_suspended_by_user", False),
                "trade_suspended_by_user",
            ),
            created_at=_optional_datetime(payload.get("created_at"), "created_at"),
            request_id=request_id,
        )
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise BrokerPayloadError(
            "Alpaca account response contains invalid fields.",
            request_id=request_id,
        ) from exc


def _normalize_clock(payload: Mapping[str, Any], request_id: Optional[str]) -> BrokerClock:
    try:
        return BrokerClock(
            timestamp=_required_datetime(payload.get("timestamp"), "timestamp"),
            is_open=_parse_bool(payload.get("is_open"), "is_open"),
            next_open=_required_datetime(payload.get("next_open"), "next_open"),
            next_close=_required_datetime(payload.get("next_close"), "next_close"),
            request_id=request_id,
        )
    except (TypeError, ValueError) as exc:
        raise BrokerPayloadError(
            "Alpaca clock response contains invalid fields.",
            request_id=request_id,
        ) from exc


def _normalize_position(payload: Mapping[str, Any]) -> BrokerPosition:
    return BrokerPosition(
        symbol=_required_text(payload.get("symbol"), "symbol").upper(),
        side=_required_text(payload.get("side"), "side").lower(),
        quantity=_required_decimal(payload.get("qty"), "qty"),
        quantity_available=_optional_decimal(payload.get("qty_available"), "qty_available"),
        average_entry_price=_optional_decimal(payload.get("avg_entry_price"), "avg_entry_price"),
        market_value=_optional_decimal(payload.get("market_value"), "market_value"),
        cost_basis=_optional_decimal(payload.get("cost_basis"), "cost_basis"),
        current_price=_optional_decimal(payload.get("current_price"), "current_price"),
        unrealized_profit_loss=_optional_decimal(payload.get("unrealized_pl"), "unrealized_pl"),
        unrealized_profit_loss_percent=_optional_decimal(
            payload.get("unrealized_plpc"),
            "unrealized_plpc",
        ),
        unrealized_intraday_profit_loss=_optional_decimal(
            payload.get("unrealized_intraday_pl"),
            "unrealized_intraday_pl",
        ),
        unrealized_intraday_profit_loss_percent=_optional_decimal(
            payload.get("unrealized_intraday_plpc"),
            "unrealized_intraday_plpc",
        ),
        asset_id=_optional_text(payload.get("asset_id")),
        asset_class=_optional_text(payload.get("asset_class")),
        exchange=_optional_text(payload.get("exchange")),
    )


def _normalize_order_or_raise(
    payload: Mapping[str, Any],
    request_id: Optional[str],
) -> BrokerOrder:
    try:
        return _normalize_order(payload, request_id=request_id)
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise BrokerPayloadError(
            "Alpaca order response contains invalid fields.",
            request_id=request_id,
        ) from exc


def normalize_alpaca_order(
    payload: Mapping[str, Any],
    *,
    request_id: Optional[str] = None,
) -> BrokerOrder:
    """Normalize an Alpaca order from REST or ``trade_updates``."""

    return _normalize_order_or_raise(payload, request_id)


def _normalize_order(
    payload: Mapping[str, Any],
    *,
    request_id: Optional[str],
) -> BrokerOrder:
    raw_legs = payload.get("legs")
    if raw_legs is None:
        raw_legs = []
    if not isinstance(raw_legs, list) or any(not isinstance(item, dict) for item in raw_legs):
        raise ValueError("legs must be an array of objects or null.")
    order_class = _optional_text(payload.get("order_class")) or "simple"
    if order_class.lower() == "mleg":
        # Alpaca intentionally leaves these aggregate fields blank on a
        # multi-leg parent; the individual legs retain their own symbols and
        # sides. Keep the existing string contract for API compatibility.
        symbol = (_optional_text(payload.get("symbol")) or "").upper()
        side = (_optional_text(payload.get("side")) or "").lower()
    else:
        symbol = _required_text(payload.get("symbol"), "symbol").upper()
        side = _required_text(payload.get("side"), "side").lower()
    return BrokerOrder(
        id=_required_text(payload.get("id"), "id"),
        client_order_id=_required_text(payload.get("client_order_id"), "client_order_id"),
        symbol=symbol,
        side=side,
        order_type=_required_text(payload.get("type") or payload.get("order_type"), "type").lower(),
        time_in_force=_required_text(payload.get("time_in_force"), "time_in_force").lower(),
        order_class=order_class.lower(),
        status=_required_text(payload.get("status"), "status").lower(),
        quantity=_optional_decimal(payload.get("qty"), "qty"),
        notional=_optional_decimal(payload.get("notional"), "notional"),
        filled_quantity=_required_decimal(payload.get("filled_qty", "0"), "filled_qty"),
        filled_average_price=_optional_decimal(
            payload.get("filled_avg_price"),
            "filled_avg_price",
        ),
        limit_price=_optional_decimal(payload.get("limit_price"), "limit_price"),
        stop_price=_optional_decimal(payload.get("stop_price"), "stop_price"),
        created_at=_optional_datetime(payload.get("created_at"), "created_at"),
        submitted_at=_optional_datetime(payload.get("submitted_at"), "submitted_at"),
        updated_at=_optional_datetime(payload.get("updated_at"), "updated_at"),
        filled_at=_optional_datetime(payload.get("filled_at"), "filled_at"),
        canceled_at=_optional_datetime(payload.get("canceled_at"), "canceled_at"),
        expired_at=_optional_datetime(payload.get("expired_at"), "expired_at"),
        failed_at=_optional_datetime(payload.get("failed_at"), "failed_at"),
        replaces=_optional_text(payload.get("replaces")),
        replaced_by=_optional_text(payload.get("replaced_by")),
        legs=tuple(_normalize_order(item, request_id=request_id) for item in raw_legs),
        request_id=request_id,
    )


def _required_text(value: Any, name: str) -> str:
    normalized = str(value).strip() if value is not None else ""
    if not normalized:
        raise ValueError(f"{name} is required.")
    return normalized


def _optional_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _required_decimal(value: Any, name: str) -> Decimal:
    if value is None or value == "":
        raise ValueError(f"{name} is required.")
    return _parse_decimal(value, name)


def _optional_decimal(value: Any, name: str) -> Optional[Decimal]:
    if value is None or value == "":
        return None
    return _parse_decimal(value, name)


def _parse_decimal(value: Any, name: str) -> Decimal:
    try:
        normalized = value if isinstance(value, Decimal) else Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be a decimal number.") from exc
    if not normalized.is_finite():
        raise ValueError(f"{name} must be finite.")
    return normalized


def _required_datetime(value: Any, name: str) -> datetime:
    parsed = _optional_datetime(value, name)
    if parsed is None:
        raise ValueError(f"{name} is required.")
    return parsed


def _optional_datetime(value: Any, name: str) -> Optional[datetime]:
    if value is None or value == "":
        return None
    try:
        return parse_datetime(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be an ISO-8601 datetime.") from exc


def _format_query_datetime(value: datetime, name: str) -> str:
    if not isinstance(value, datetime):
        raise ValueError(f"{name} must be a datetime.")
    if value.tzinfo is None:
        raise ValueError(f"{name} must include a timezone.")
    return value.isoformat()


def _parse_bool(value: Any, name: str) -> bool:
    if isinstance(value, bool):
        return value
    if value in {0, 1}:
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1"}:
            return True
        if normalized in {"false", "0"}:
            return False
    raise ValueError(f"{name} must be a boolean.")


def _format_decimal(value: Decimal) -> str:
    formatted = format(value, "f")
    if "." in formatted:
        formatted = formatted.rstrip("0").rstrip(".")
    return formatted


def _validate_client_order_id(value: str) -> str:
    normalized = str(value).strip()
    if not normalized:
        raise ValueError("client_order_id is required.")
    if len(normalized) > 128:
        raise ValueError("client_order_id must be at most 128 characters.")
    return normalized


def _normalize_symbols(symbols: Sequence[str]) -> Tuple[str, ...]:
    normalized = []
    seen = set()
    for value in symbols:
        symbol = str(value).strip().upper()
        if symbol and symbol not in seen:
            normalized.append(symbol)
            seen.add(symbol)
    return tuple(normalized)
