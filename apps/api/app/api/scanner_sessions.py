from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status

from app.scanner_sessions import (
    ScannerSessionActive,
    ScannerSessionNotFound,
    ScannerSessions,
    get_scanner_sessions,
)
from app.scanner_sessions.supplementary_csv import (
    MAX_SUPPLEMENTARY_CSV_BYTES,
    SupplementaryCsvError,
    parse_supplementary_csv,
)
from app.schemas.scanner_sessions import (
    ScannerSessionRead,
    ScannerSessionStart,
    ScannerSessionSummaryRead,
    SupplementaryDiscoveryInput,
)


router = APIRouter(prefix="/scanner-sessions", tags=["scanner-sessions"])


async def _start(
    scanner_sessions: ScannerSessions,
    inputs: list[SupplementaryDiscoveryInput] | None = None,
) -> ScannerSessionRead:
    try:
        return await scanner_sessions.start(inputs)
    except ScannerSessionActive as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("", response_model=ScannerSessionRead, status_code=status.HTTP_202_ACCEPTED)
async def start_scanner_session(
    payload: ScannerSessionStart | None = None,
    scanner_sessions: ScannerSessions = Depends(get_scanner_sessions),
) -> ScannerSessionRead:
    return await _start(scanner_sessions, payload.supplementary_inputs if payload else None)


@router.post(
    "/import-csv",
    response_model=ScannerSessionRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_scanner_session_from_csv(
    file: UploadFile = File(...),
    scanner_sessions: ScannerSessions = Depends(get_scanner_sessions),
) -> ScannerSessionRead:
    if file.size is not None and file.size > MAX_SUPPLEMENTARY_CSV_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Supplementary CSV exceeds the {MAX_SUPPLEMENTARY_CSV_BYTES} byte limit.",
        )
    content = await file.read(MAX_SUPPLEMENTARY_CSV_BYTES + 1)
    if len(content) > MAX_SUPPLEMENTARY_CSV_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Supplementary CSV exceeds the {MAX_SUPPLEMENTARY_CSV_BYTES} byte limit.",
        )
    try:
        inputs = parse_supplementary_csv(content, filename=file.filename or "supplementary.csv")
    except SupplementaryCsvError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"message": str(exc), "errors": exc.errors},
        ) from exc
    return await _start(scanner_sessions, inputs)


@router.get("", response_model=list[ScannerSessionSummaryRead])
def list_scanner_sessions(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    scanner_sessions: ScannerSessions = Depends(get_scanner_sessions),
) -> list[ScannerSessionSummaryRead]:
    return scanner_sessions.list(limit=limit, offset=offset)


@router.get("/current", response_model=ScannerSessionRead | None)
def get_current_scanner_session(
    scanner_sessions: ScannerSessions = Depends(get_scanner_sessions),
) -> ScannerSessionRead | None:
    return scanner_sessions.current()


@router.post("/{session_id}/cancel", response_model=ScannerSessionRead)
async def cancel_scanner_session(
    session_id: int,
    scanner_sessions: ScannerSessions = Depends(get_scanner_sessions),
) -> ScannerSessionRead:
    try:
        return await scanner_sessions.cancel(session_id)
    except ScannerSessionNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.get("/{session_id}", response_model=ScannerSessionRead)
def get_scanner_session(
    session_id: int,
    scanner_sessions: ScannerSessions = Depends(get_scanner_sessions),
) -> ScannerSessionRead:
    try:
        return scanner_sessions.get(session_id)
    except ScannerSessionNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
