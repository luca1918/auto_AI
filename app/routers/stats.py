from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app import stats
from app.db import get_db
from app.models import User
from app.routers.common import own_account
from app.schemas import StatsOut
from app.security import current_user

router = APIRouter(prefix="/api/stats", tags=["statistics"])


@router.get("", response_model=StatsOut)
def account_stats(
    account_id: int,
    month: str | None = Query(None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$", description="YYYY-MM, implicit luna curentă"),
    months: int = Query(6, ge=1, le=12),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    account = own_account(db, user, account_id)
    return {"account_id": account.id, "currency": account.currency, **stats.summarize(db, account.id, month, months)}
