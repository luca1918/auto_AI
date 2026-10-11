"""Idempotency-Key support for money-moving endpoints.

The key row is inserted in the same DB transaction as the operation, before any balance
changes. A concurrent duplicate blocks on the unique constraint until the first request
commits, then replays its stored response. Failed operations roll back the key too, so a
client may retry them."""

import hashlib
import json
from collections.abc import Callable

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import IdempotencyKey

MAX_KEY_LENGTH = 255


def _replay(row: IdempotencyKey, request_hash: str) -> JSONResponse:
    if row.request_hash != request_hash:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT,
                            "Cheia de idempotență a fost folosită pentru o altă cerere")
    if row.response_status is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "O cerere cu această cheie este în curs de procesare")
    return JSONResponse(json.loads(row.response_body), status_code=row.response_status,
                        headers={"Idempotent-Replayed": "true"})


def run(db: Session, user_id: int, key: str | None, fingerprint: dict,
        operation: Callable[[], object], status_code: int = status.HTTP_201_CREATED) -> JSONResponse:
    """Runs `operation` (which must not commit) and commits it atomically with the key."""
    if key is None:
        try:
            body = jsonable_encoder(operation())
            db.commit()
        except Exception:
            db.rollback()
            raise
        return JSONResponse(body, status_code=status_code)

    if not 0 < len(key) <= MAX_KEY_LENGTH:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Idempotency-Key invalid")
    request_hash = hashlib.sha256(json.dumps(fingerprint, sort_keys=True, default=str).encode()).hexdigest()

    def existing() -> IdempotencyKey | None:
        return db.scalar(select(IdempotencyKey).where(IdempotencyKey.user_id == user_id, IdempotencyKey.key == key))

    if (row := existing()) is not None:
        return _replay(row, request_hash)

    try:
        row = IdempotencyKey(user_id=user_id, key=key, request_hash=request_hash)
        db.add(row)
        db.flush()
    except IntegrityError:
        # A concurrent request with the same key won the race and has committed by now.
        db.rollback()
        if (row := existing()) is None:  # the other request failed and rolled back its key
            raise HTTPException(status.HTTP_409_CONFLICT, "Cerere concurentă cu aceeași cheie; reîncearcă")
        return _replay(row, request_hash)

    try:
        body = jsonable_encoder(operation())
        row.response_status = status_code
        row.response_body = json.dumps(body)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return JSONResponse(body, status_code=status_code)
