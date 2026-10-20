from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app import audit, banking
from app.db import get_db
from app.models import GoalEntry, SavingsGoal, User
from app.routers.common import IdempotencyKeyHeader, minor, money_op, own_account
from app.schemas import GoalAmountIn, GoalCreate, GoalEntryOut, GoalOut, GoalUpdate
from app.security import current_user

router = APIRouter(prefix="/api/goals", tags=["savings"])

MAX_GOALS_PER_USER = 20


def _out(goal: SavingsGoal) -> GoalOut:
    return GoalOut.model_validate({**{c: getattr(goal, c) for c in GoalOut.model_fields if c != "currency"},
                                   "currency": goal.account.currency})


def _own_goal(db: Session, user: User, goal_id: int) -> SavingsGoal:
    goal = db.get(SavingsGoal, goal_id)
    if goal is None or goal.owner_id != user.id or goal.closed_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pușculiță inexistentă")
    return goal


def _single_roundup_goal(db: Session, goal: SavingsGoal) -> None:
    """Only one goal per account collects round-ups, so each payment's spare change has one destination."""
    db.execute(update(SavingsGoal).where(SavingsGoal.account_id == goal.account_id, SavingsGoal.id != goal.id)
               .values(roundup_enabled=False))


@router.get("", response_model=list[GoalOut])
def list_goals(user: User = Depends(current_user), db: Session = Depends(get_db)):
    goals = db.scalars(select(SavingsGoal).where(SavingsGoal.owner_id == user.id, SavingsGoal.closed_at.is_(None))
                       .order_by(SavingsGoal.id)).all()
    return [_out(g) for g in goals]


@router.post("", response_model=GoalOut, status_code=status.HTTP_201_CREATED)
def create_goal(body: GoalCreate, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    own_account(db, user, body.account_id)
    count = db.scalar(select(func.count()).select_from(SavingsGoal)
                      .where(SavingsGoal.owner_id == user.id, SavingsGoal.closed_at.is_(None)))
    if count >= MAX_GOALS_PER_USER:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ai atins numărul maxim de pușculițe")
    goal = SavingsGoal(owner_id=user.id, account_id=body.account_id, name=body.name.strip(), emoji=body.emoji,
                       target=minor(body.target), balance=0, roundup_enabled=body.roundup_enabled,
                       deadline=body.deadline)
    db.add(goal)
    db.flush()
    if goal.roundup_enabled:
        _single_roundup_goal(db, goal)
    audit.record(db, request, "goal.created", user.id, goal_id=goal.id)
    db.commit()
    return _out(goal)


@router.get("/{goal_id}", response_model=GoalOut)
def get_goal(goal_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return _out(_own_goal(db, user, goal_id))


@router.patch("/{goal_id}", response_model=GoalOut)
def update_goal(goal_id: int, body: GoalUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    goal = _own_goal(db, user, goal_id)
    fields = body.model_fields_set
    if body.name is not None:
        goal.name = body.name.strip()
    if body.emoji is not None:
        goal.emoji = body.emoji
    if body.target is not None:
        goal.target = minor(body.target)
    if "deadline" in fields:
        goal.deadline = body.deadline
    if body.roundup_enabled is not None:
        goal.roundup_enabled = body.roundup_enabled
        if body.roundup_enabled:
            _single_roundup_goal(db, goal)
    db.commit()
    return _out(goal)


@router.get("/{goal_id}/entries", response_model=list[GoalEntryOut])
def list_entries(goal_id: int, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                 user: User = Depends(current_user), db: Session = Depends(get_db)):
    _own_goal(db, user, goal_id)
    return db.scalars(select(GoalEntry).where(GoalEntry.goal_id == goal_id)
                      .order_by(GoalEntry.id.desc()).limit(limit).offset(offset)).all()


def _entry_audit(entry: GoalEntry) -> dict:
    return {"goal_id": entry.goal_id, "amount": entry.amount, "reference": entry.reference}


@router.post("/{goal_id}/deposit", response_model=GoalEntryOut, status_code=status.HTTP_201_CREATED)
def deposit(goal_id: int, body: GoalAmountIn, request: Request, user: User = Depends(current_user),
            db: Session = Depends(get_db), idempotency_key: str | None = IdempotencyKeyHeader):
    goal = _own_goal(db, user, goal_id)
    amount = minor(body.amount)
    return money_op(db, request, user, idempotency_key, {"op": "goal_deposit", "goal": goal_id, "amount": amount},
                    "goal.deposit", lambda: banking.goal_deposit(db, goal, amount), GoalEntryOut, _entry_audit)


@router.post("/{goal_id}/withdraw", response_model=GoalEntryOut, status_code=status.HTTP_201_CREATED)
def withdraw(goal_id: int, body: GoalAmountIn, request: Request, user: User = Depends(current_user),
             db: Session = Depends(get_db), idempotency_key: str | None = IdempotencyKeyHeader):
    goal = _own_goal(db, user, goal_id)
    amount = minor(body.amount)
    return money_op(db, request, user, idempotency_key, {"op": "goal_withdraw", "goal": goal_id, "amount": amount},
                    "goal.withdrawal", lambda: banking.goal_withdraw(db, goal, amount), GoalEntryOut, _entry_audit)


@router.delete("/{goal_id}", response_model=GoalOut)
def close_goal(goal_id: int, request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)):
    goal = _own_goal(db, user, goal_id)
    try:
        banking.close_goal(db, goal)
        audit.record(db, request, "goal.closed", user.id, goal_id=goal.id)
        db.commit()
    except banking.BankingError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, exc.message)
    return _out(goal)
