from collections.abc import Callable

from fastapi import Header, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import audit, banking, idempotency
from app.models import Account, User
from app.money import to_minor

IdempotencyKeyHeader = Header(default=None, alias="Idempotency-Key", max_length=idempotency.MAX_KEY_LENGTH,
                              description="Cheie unică per operațiune; reîncercările cu aceeași cheie nu o repetă.")


def own_account(db: Session, user: User, account_id: int) -> Account:
    account = db.get(Account, account_id)
    if account is None or account.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Cont inexistent")
    return account


def minor(amount) -> int:
    try:
        return to_minor(amount)
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc))


def money_op(db: Session, request: Request, user: User, key: str | None, fingerprint: dict, action: str,
             op: Callable[[], object], out_model: type[BaseModel], audit_details: Callable[[object], dict]):
    """Runs a money-moving operation idempotently, auditing it in the same DB transaction."""
    def operation():
        try:
            result = op()
        except banking.BankingError as exc:
            raise HTTPException(exc.status_code, exc.message)
        audit.record(db, request, action, user.id, **audit_details(result))
        return out_model.model_validate(result)

    return idempotency.run(db, user.id, key, fingerprint, operation)
