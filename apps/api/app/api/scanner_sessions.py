from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.scanner_sessions import ScannerSessionNotFound, ScannerSessions, get_scanner_sessions
from app.scanner_sessions.supplementary_csv import SupplementaryCsvError, parse_supplementary_csv
from app.schemas.scanner_sessions import ScannerSessionRead, ScannerSessionStart


router = APIRouter(prefix="/scanner-sessions", tags=["scanner-sessions"])


@router.post("", response_model=ScannerSessionRead, status_code=status.HTTP_202_ACCEPTED)
async def start_scanner_session(
    payload: ScannerSessionStart | None = None,
    scanner_sessions: ScannerSessions = Depends(get_scanner_sessions),
) -> ScannerSessionRead:
    return await scanner_sessions.start(payload.supplementary_inputs if payload else None)


@router.post(
    "/import-csv",
    response_model=ScannerSessionRead,
    status_code=status.HTTP_202_ACCEPTED,
)
async def start_scanner_session_from_csv(
    file: UploadFile = File(...),
    scanner_sessions: ScannerSessions = Depends(get_scanner_sessions),
) -> ScannerSessionRead:
    content = await file.read()
    try:
        inputs = parse_supplementary_csv(content, filename=file.filename or "supplementary.csv")
    except SupplementaryCsvError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"message": str(exc), "errors": exc.errors},
        ) from exc
    return await scanner_sessions.start(inputs)


@router.get("", response_model=list[ScannerSessionRead])
def list_scanner_sessions(
    scanner_sessions: ScannerSessions = Depends(get_scanner_sessions),
) -> list[ScannerSessionRead]:
    return scanner_sessions.list()


@router.get("/{session_id}", response_model=ScannerSessionRead)
def get_scanner_session(
    session_id: int,
    scanner_sessions: ScannerSessions = Depends(get_scanner_sessions),
) -> ScannerSessionRead:
    try:
        return scanner_sessions.get(session_id)
    except ScannerSessionNotFound as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
