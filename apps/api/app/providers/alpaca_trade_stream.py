"""Durable-input adapter for Alpaca Trading API ``trade_updates``.

The worker is the sole connection owner. Persistence and reconnection live in
the service layer; this module only authenticates, subscribes, validates, and
normalizes frames from the exact paper endpoint.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
from typing import Any, Awaitable, Callable, Mapping, Optional

from websockets.asyncio.client import connect as websocket_connect

from app.providers._normalization import parse_datetime
from app.providers.alpaca_broker import normalize_alpaca_order
from app.providers.broker import (
    BrokerAuthenticationError,
    BrokerConfigurationError,
    BrokerPayloadError,
    BrokerTradeUpdate,
    BrokerTransportError,
)


ALPACA_PAPER_TRADE_STREAM_URL = "wss://paper-api.alpaca.markets/stream"


class AlpacaTradeUpdateStream:
    def __init__(
        self,
        api_key: str,
        api_secret: str,
        *,
        url: str = ALPACA_PAPER_TRADE_STREAM_URL,
        connector: Optional[Callable[..., Awaitable[Any]]] = None,
    ) -> None:
        self._api_key = _required(api_key, "api_key")
        self._api_secret = _required(api_secret, "api_secret")
        normalized_url = str(url).strip().rstrip("/").lower()
        if normalized_url != ALPACA_PAPER_TRADE_STREAM_URL:
            raise BrokerConfigurationError(
                "Trade-update streaming is restricted to the exact Alpaca paper endpoint."
            )
        self._url = ALPACA_PAPER_TRADE_STREAM_URL
        self._connector = connector or websocket_connect
        self._connection: Any = None

    async def connect(self) -> None:
        try:
            self._connection = await self._connector(
                self._url,
                open_timeout=20,
                ping_interval=20,
                ping_timeout=20,
                close_timeout=10,
                max_size=2**20,
            )
            await self._connection.send(
                json.dumps(
                    {"action": "auth", "key": self._api_key, "secret": self._api_secret},
                    separators=(",", ":"),
                )
            )
            authorization = await self._receive_object()
            auth_data = authorization.get("data")
            if (
                authorization.get("stream") != "authorization"
                or not isinstance(auth_data, dict)
                or auth_data.get("status") != "authorized"
            ):
                await self.aclose()
                raise BrokerAuthenticationError("Alpaca rejected trade-stream authentication.")

            await self._connection.send(
                json.dumps(
                    {"action": "listen", "data": {"streams": ["trade_updates"]}},
                    separators=(",", ":"),
                )
            )
            listening = await self._receive_object()
            listening_data = listening.get("data")
            streams = listening_data.get("streams") if isinstance(listening_data, dict) else None
            if listening.get("stream") != "listening" or "trade_updates" not in (streams or []):
                await self.aclose()
                raise BrokerPayloadError("Alpaca did not confirm the trade_updates subscription.")
        except (BrokerAuthenticationError, BrokerPayloadError):
            raise
        except asyncio.CancelledError:
            await self.aclose()
            raise
        except Exception as exc:
            await self.aclose()
            raise BrokerTransportError(
                "The Alpaca paper trade-update stream could not be connected.",
                outcome_unknown=False,
            ) from exc

    async def receive(self) -> BrokerTradeUpdate:
        if self._connection is None:
            raise BrokerTransportError("The trade-update stream is not connected.", outcome_unknown=False)
        while True:
            try:
                envelope = await self._receive_object()
            except asyncio.CancelledError:
                raise
            except BrokerPayloadError:
                raise
            except Exception as exc:
                raise BrokerTransportError(
                    "The Alpaca paper trade-update stream disconnected.",
                    outcome_unknown=False,
                ) from exc
            if envelope.get("stream") != "trade_updates":
                continue
            return normalize_trade_update(envelope)

    async def _receive_object(self) -> dict[str, Any]:
        if self._connection is None:
            raise BrokerTransportError("The trade-update stream is not connected.", outcome_unknown=False)
        # A paper account can legitimately be quiet for hours. Connection
        # liveness is handled by the protocol ping/pong timeout configured at
        # connect time, not by the absence of order events.
        frame = await self._connection.recv()
        if isinstance(frame, bytes):
            try:
                frame = frame.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise BrokerPayloadError("Alpaca sent a non-UTF-8 trade-stream frame.") from exc
        if not isinstance(frame, str):
            raise BrokerPayloadError("Alpaca sent an unsupported trade-stream frame type.")
        try:
            payload = json.loads(frame)
        except json.JSONDecodeError as exc:
            raise BrokerPayloadError("Alpaca sent invalid JSON on the trade stream.") from exc
        if not isinstance(payload, dict):
            raise BrokerPayloadError("Alpaca trade-stream frames must be JSON objects.")
        return payload

    async def aclose(self) -> None:
        connection, self._connection = self._connection, None
        if connection is not None:
            try:
                await connection.close()
            except Exception:
                pass


def normalize_trade_update(envelope: Mapping[str, Any]) -> BrokerTradeUpdate:
    if envelope.get("stream") != "trade_updates":
        raise BrokerPayloadError("Expected an Alpaca trade_updates envelope.")
    data = envelope.get("data")
    if not isinstance(data, Mapping):
        raise BrokerPayloadError("Alpaca trade_updates data must be an object.")
    event_type = _required(data.get("event"), "event").lower()
    raw_order = data.get("order")
    if not isinstance(raw_order, Mapping):
        raise BrokerPayloadError("Alpaca trade_updates is missing its order object.")
    order = normalize_alpaca_order(raw_order)
    occurred_at = _event_time(data, envelope, order.updated_at or order.submitted_at)
    received_at = datetime.now(timezone.utc)
    execution_id = _optional(data.get("execution_id"))
    event_id = _optional(data.get("event_id")) or _optional(envelope.get("event_id"))
    provider_event_id = _provider_event_id(
        envelope,
        event_type=event_type,
        order_id=order.id,
        execution_id=execution_id,
        event_id=event_id,
    )
    return BrokerTradeUpdate(
        provider="alpaca",
        provider_event_id=provider_event_id,
        stream="trade_updates",
        event_type=event_type,
        order=order,
        occurred_at=occurred_at,
        received_at=received_at,
        execution_id=execution_id,
        price=_optional_decimal(data.get("price"), "price"),
        quantity=_optional_decimal(data.get("qty"), "qty"),
        position_quantity=_optional_decimal(data.get("position_qty"), "position_qty"),
        raw_data=dict(envelope),
    )


def _provider_event_id(
    envelope: Mapping[str, Any],
    *,
    event_type: str,
    order_id: str,
    execution_id: Optional[str],
    event_id: Optional[str],
) -> str:
    if event_id:
        return f"alpaca:event:{event_id}"
    if execution_id:
        return f"alpaca:execution:{execution_id}:{event_type}"
    canonical = json.dumps(envelope, sort_keys=True, separators=(",", ":"), default=str)
    fingerprint = hashlib.sha256(canonical.encode()).hexdigest()
    return f"alpaca:trade:{order_id}:{fingerprint[:32]}"


def _event_time(
    data: Mapping[str, Any],
    envelope: Mapping[str, Any],
    fallback: Optional[datetime],
) -> datetime:
    value = data.get("timestamp") or data.get("at") or envelope.get("at")
    if value is not None:
        try:
            return parse_datetime(value)
        except (TypeError, ValueError) as exc:
            raise BrokerPayloadError("Alpaca trade update has an invalid timestamp.") from exc
    return fallback or datetime.now(timezone.utc)


def _required(value: Any, name: str) -> str:
    normalized = str(value).strip() if value is not None else ""
    if not normalized:
        raise BrokerConfigurationError(f"{name} is required for Alpaca trade streaming.")
    return normalized


def _optional(value: Any) -> Optional[str]:
    normalized = str(value).strip() if value is not None else ""
    return normalized or None


def _optional_decimal(value: Any, name: str) -> Optional[Decimal]:
    if value is None or value == "":
        return None
    try:
        normalized = value if isinstance(value, Decimal) else Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise BrokerPayloadError(f"Alpaca trade update field {name} must be a decimal.") from exc
    if not normalized.is_finite():
        raise BrokerPayloadError(f"Alpaca trade update field {name} must be finite.")
    return normalized
