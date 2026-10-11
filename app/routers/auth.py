from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import audit, config, iban as iban_lib
from app.db import get_db
from app.models import Account, User
from app.ratelimit import RateLimiter
from app.schemas import LoginIn, RegisterIn, TokenOut, UserOut
from app.security import create_token, current_user, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

auth_rate_limit = RateLimiter(config.AUTH_RATE_LIMIT_PER_MINUTE)

# Equalizes login timing for unknown emails so they can't be enumerated.
_DUMMY_HASH = hash_password("dummy-password")


def _as_utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)  # SQLite drops tzinfo


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED,
             dependencies=[Depends(auth_rate_limit)])
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Există deja un cont cu acest email")
    user = User(email=email, full_name=body.full_name.strip(), password_hash=hash_password(body.password))
    # Every new customer gets a RON current account.
    user.accounts.append(Account(iban=iban_lib.generate_ro(), name="Cont curent", currency="RON", balance=0))
    db.add(user)
    db.flush()
    audit.record(db, request, "user.registered", user.id)
    db.commit()
    return user


@router.post("/login", response_model=TokenOut, dependencies=[Depends(auth_rate_limit)])
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email).with_for_update())
    now = datetime.now(timezone.utc)

    if user and user.locked_until and _as_utc(user.locked_until) > now:
        db.rollback()
        raise HTTPException(status.HTTP_423_LOCKED, "Cont blocat temporar după prea multe încercări eșuate")

    if not verify_password(body.password, user.password_hash if user else _DUMMY_HASH) or not user:
        if user:
            user.failed_logins += 1
            if user.failed_logins >= config.LOGIN_MAX_FAILURES:
                user.failed_logins = 0
                user.locked_until = now + timedelta(minutes=config.LOGIN_LOCK_MINUTES)
                audit.record(db, request, "user.locked", user.id)
        audit.record(db, request, "login.failed", user.id if user else None, email=email)
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email sau parolă greșită")

    user.failed_logins = 0
    user.locked_until = None
    audit.record(db, request, "login.succeeded", user.id)
    db.commit()
    return TokenOut(access_token=create_token(user.id))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user
