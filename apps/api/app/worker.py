from __future__ import annotations

import asyncio
import logging

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.providers.alpaca_trade_stream import AlpacaTradeUpdateStream
from app.services.automation import run_automation_once
from app.services.brokers import create_broker
from app.services.order_stream import (
    backfill_broker_orders,
    ingest_and_process_trade_update,
    process_pending_trade_updates,
    set_stream_status,
)


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("paper-automation-worker")


async def run_automation_loop(settings) -> None:
    poll_seconds = max(1, settings.automation_poll_seconds)
    while True:
        try:
            with SessionLocal() as db:
                stats = await run_automation_once(db, settings)
                if stats.processed or stats.reconciled or stats.failed:
                    logger.info(
                        "Automation cycle: processed=%s submitted=%s reconciled=%s failed=%s",
                        stats.processed,
                        stats.submitted,
                        stats.reconciled,
                        stats.failed,
                    )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Paper automation cycle failed; no blind order retry will be attempted.")
        await asyncio.sleep(poll_seconds)


async def run_trade_update_loop(settings) -> None:
    if (
        not settings.alpaca_configured
        or not settings.alpaca_paper_mode
        or not settings.alpaca_paper_stream_mode
        or settings.allow_live_trading
    ):
        with SessionLocal() as db:
            set_stream_status(
                db,
                "disabled",
                error=(
                    "Trade updates require configured credentials and the exact Alpaca paper "
                    "REST/WebSocket endpoints with live trading disabled."
                ),
            )
        logger.info("Alpaca trade-update stream is disabled by paper-safety configuration.")
        await asyncio.Event().wait()

    broker = create_broker(settings)
    reconnect_delay = max(0.1, settings.broker_stream_reconnect_min_seconds)
    reconnect_max = max(reconnect_delay, settings.broker_stream_reconnect_max_seconds)
    try:
        while True:
            stream = None
            try:
                with SessionLocal() as db:
                    set_stream_status(db, "connecting")
                    processed, failed = await process_pending_trade_updates(db, broker)
                    inserted, duplicates = await backfill_broker_orders(db, broker)
                    if processed or failed or inserted or duplicates:
                        logger.info(
                            "Trade-update recovery: pending_processed=%s pending_failed=%s "
                            "backfilled=%s duplicates=%s",
                            processed,
                            failed,
                            inserted,
                            duplicates,
                        )

                stream = AlpacaTradeUpdateStream(
                    settings.alpaca_api_key_id,
                    settings.alpaca_api_secret_key,
                    url=settings.alpaca_trade_stream_url,
                )
                await stream.connect()
                with SessionLocal() as db:
                    set_stream_status(db, "listening", connected=True)
                logger.info("Listening for Alpaca paper trade updates.")
                reconnect_delay = max(0.1, settings.broker_stream_reconnect_min_seconds)

                while True:
                    update = await stream.receive()
                    with SessionLocal() as db:
                        stored, duplicate = await ingest_and_process_trade_update(db, update, broker)
                    logger.info(
                        "Trade update %s order=%s event=%s duplicate=%s processed=%s",
                        stored.provider_event_id,
                        stored.broker_order_id,
                        stored.event_type,
                        duplicate,
                        stored.processed_at is not None,
                    )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.exception(
                    "Alpaca trade-update stream interrupted; REST recovery will run before reconnect."
                )
                with SessionLocal() as db:
                    set_stream_status(
                        db,
                        "reconnecting",
                        error=str(exc)[:2000],
                        disconnected=True,
                        reconnect=True,
                    )
                await asyncio.sleep(reconnect_delay)
                reconnect_delay = min(reconnect_max, reconnect_delay * 2)
            finally:
                if stream is not None:
                    await stream.aclose()
    finally:
        await broker.aclose()


async def run_worker() -> None:
    settings = get_settings()
    logger.info("Paper automation worker started; live trading is disabled.")
    await asyncio.gather(
        run_automation_loop(settings),
        run_trade_update_loop(settings),
    )


def main() -> None:
    try:
        asyncio.run(run_worker())
    except KeyboardInterrupt:
        logger.info("Paper automation worker stopped.")


if __name__ == "__main__":
    main()
