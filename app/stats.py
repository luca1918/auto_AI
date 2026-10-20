"""Income / expense statistics for one account, by calendar month in the bank's timezone."""

from collections import defaultdict
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import config
from app.models import Transaction


def _month_key(dt: datetime, tz: ZoneInfo) -> str:
    if dt.tzinfo is None:  # SQLite returns naive UTC
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(tz).strftime("%Y-%m")


def _shift(year: int, month: int, delta: int) -> tuple[int, int]:
    index = year * 12 + (month - 1) + delta
    return index // 12, index % 12 + 1


def summarize(db: Session, account_id: int, month: str | None, months: int = 6) -> dict:
    tz = ZoneInfo(config.TIMEZONE)
    if month is None:
        month = datetime.now(tz).strftime("%Y-%m")
    year, mon = map(int, month.split("-"))

    keys = [f"{y:04d}-{m:02d}" for y, m in (_shift(year, mon, -i) for i in range(months - 1, -1, -1))]
    start_y, start_m = _shift(year, mon, -(months - 1))
    end_y, end_m = _shift(year, mon, 1)
    start = datetime(start_y, start_m, 1, tzinfo=tz).astimezone(timezone.utc)
    end = datetime(end_y, end_m, 1, tzinfo=tz).astimezone(timezone.utc)

    rows = db.execute(
        select(Transaction.amount, Transaction.category, Transaction.created_at).where(
            Transaction.account_id == account_id,
            Transaction.created_at >= start,
            Transaction.created_at < end,
            Transaction.category.not_in(config.NON_SPENDING_CATEGORIES),
        )
    ).all()

    series = {k: {"month": k, "income": 0, "expenses": 0} for k in keys}
    categories: dict[str, dict] = defaultdict(lambda: {"amount": 0, "count": 0})
    for amount, category, created_at in rows:
        key = _month_key(created_at, tz)
        if key not in series:
            continue
        if amount > 0:
            series[key]["income"] += amount
        else:
            series[key]["expenses"] += -amount
            if key == month:
                categories[category]["amount"] += -amount
                categories[category]["count"] += 1

    current = series[month]
    total = current["expenses"]
    previous = series[keys[-2]]["expenses"] if len(keys) > 1 else None
    return {
        "month": month,
        "months": list(series.values()),
        "total_income": current["income"],
        "total_expenses": total,
        "previous_expenses": previous,
        "categories": sorted(
            ({"category": c, "amount": v["amount"], "count": v["count"],
              "share": round(v["amount"] / total, 4) if total else 0} for c, v in categories.items()),
            key=lambda c: c["amount"], reverse=True,
        ),
    }
