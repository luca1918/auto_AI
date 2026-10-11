from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db

router = APIRouter(tags=["health"])


@router.get("/health/live")
def live():
    return {"status": "ok"}


@router.get("/health/ready")
def ready(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse({"status": "unavailable", "database": "down"}, status_code=503)
    return {"status": "ok", "database": "up"}
