from __future__ import annotations

import asyncio
import logging

from app.core.config import get_settings
from app.core.database import SessionLocal
from app.services.automation import run_automation_once


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("paper-automation-worker")


async def run_worker() -> None:
    settings = get_settings()
    poll_seconds = max(1, settings.automation_poll_seconds)
    logger.info("Paper automation worker started; live trading is disabled.")
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


def main() -> None:
    try:
        asyncio.run(run_worker())
    except KeyboardInterrupt:
        logger.info("Paper automation worker stopped.")


if __name__ == "__main__":
    main()
