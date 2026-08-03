from fastapi import APIRouter, Depends, HTTPException, status

from app.scanner_sessions import ScannerSessionNotFound, ScannerSessions, get_scanner_sessions
from app.schemas.scanner_sessions import ScannerSessionRead


router = APIRouter(prefix="/scanner-sessions", tags=["scanner-sessions"])


@router.post("", response_model=ScannerSessionRead, status_code=status.HTTP_202_ACCEPTED)
async def start_scanner_session(
    scanner_sessions: ScannerSessions = Depends(get_scanner_sessions),
) -> ScannerSessionRead:
    return await scanner_sessions.start()


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
