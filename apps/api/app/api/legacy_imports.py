from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.legacy_imports import LegacyImport
from app.schemas.legacy_imports import LegacyImportRead


router = APIRouter(prefix="/legacy-imports", tags=["legacy-imports"])


@router.get("", response_model=list[LegacyImportRead])
def list_legacy_imports(
    context: Literal["operational", "demo"] = Query(default="operational"),
    db: Session = Depends(get_db),
) -> list[LegacyImportRead]:
    query = db.query(LegacyImport)
    if context == "demo":
        query = query.filter(LegacyImport.data_origin == "demo")
    else:
        query = query.filter(LegacyImport.data_origin != "demo")
    rows = query.order_by(LegacyImport.original_updated_at.desc(), LegacyImport.id.desc()).all()
    return [
        LegacyImportRead.model_validate({**row.__dict__, "legacy_status": row.status})
        for row in rows
    ]
