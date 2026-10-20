from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import iban as iban_lib
from app.db import get_db
from app.models import Beneficiary, User
from app.schemas import BeneficiaryIn, BeneficiaryOut, BeneficiaryUpdate
from app.security import current_user

router = APIRouter(prefix="/api/beneficiaries", tags=["beneficiaries"])

MAX_BENEFICIARIES = 100


def _own(db: Session, user: User, beneficiary_id: int) -> Beneficiary:
    b = db.get(Beneficiary, beneficiary_id)
    if b is None or b.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Beneficiar inexistent")
    return b


@router.get("", response_model=list[BeneficiaryOut])
def list_beneficiaries(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return db.scalars(select(Beneficiary).where(Beneficiary.owner_id == user.id)
                      .order_by(func.lower(Beneficiary.name))).all()


@router.post("", response_model=BeneficiaryOut, status_code=status.HTTP_201_CREATED)
def add_beneficiary(body: BeneficiaryIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    iban = iban_lib.normalize(body.iban)
    if not iban_lib.is_valid(iban):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "IBAN invalid")
    if db.scalar(select(Beneficiary).where(Beneficiary.owner_id == user.id, Beneficiary.iban == iban)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Beneficiarul există deja")
    count = db.scalar(select(func.count()).select_from(Beneficiary).where(Beneficiary.owner_id == user.id))
    if count >= MAX_BENEFICIARIES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Ai atins numărul maxim de beneficiari")
    b = Beneficiary(owner_id=user.id, name=body.name.strip(), iban=iban)
    db.add(b)
    db.commit()
    return b


@router.patch("/{beneficiary_id}", response_model=BeneficiaryOut)
def rename_beneficiary(beneficiary_id: int, body: BeneficiaryUpdate, user: User = Depends(current_user),
                       db: Session = Depends(get_db)):
    b = _own(db, user, beneficiary_id)
    b.name = body.name.strip()
    db.commit()
    return b


@router.delete("/{beneficiary_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_beneficiary(beneficiary_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(_own(db, user, beneficiary_id))
    db.commit()
