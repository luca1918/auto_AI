from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import iban as iban_lib
from app.db import get_db
from app.models import Account, User
from app.schemas import LoginIn, RegisterIn, TokenOut, UserOut
from app.security import create_token, current_user, hash_password, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Equalizes login timing for unknown emails so they can't be enumerated.
_DUMMY_HASH = hash_password("dummy-password")


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Există deja un cont cu acest email")
    user = User(email=email, full_name=body.full_name.strip(), password_hash=hash_password(body.password))
    # Every new customer gets a RON current account.
    user.accounts.append(Account(iban=iban_lib.generate_ro(), name="Cont curent", currency="RON", balance=0))
    db.add(user)
    db.commit()
    return user


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    ok = verify_password(body.password, user.password_hash if user else _DUMMY_HASH)
    if not user or not ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email sau parolă greșită")
    return TokenOut(access_token=create_token(user.id))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user
