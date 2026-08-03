from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.api.integrations import router as integrations_router
from app.api.scanner_sessions import router as scanner_sessions_router
from app.core.config import get_settings
from app.core.database import SessionLocal
from app.services.seed import initialize_application_data
from app.scanner_sessions import get_scanner_sessions


@asynccontextmanager
async def lifespan(app: FastAPI):
    scanner_sessions = get_scanner_sessions()
    scanner_sessions.recover_interrupted()
    with SessionLocal() as db:
        initialize_application_data(db, app_mode=settings.app_mode)
    try:
        yield
    finally:
        await scanner_sessions.shutdown()


settings = get_settings()
app = FastAPI(
    title="Small-Cap Catalyst Momentum Trading Tool API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)
app.include_router(integrations_router)
app.include_router(scanner_sessions_router)
