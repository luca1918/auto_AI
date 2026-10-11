from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditEvent
from app.observability import client_ip, request_id_var


def record(db: Session, request: Request, action: str, user_id: int | None = None, **details) -> None:
    """Adds an audit event to the session; it is persisted with the caller's commit."""
    db.add(AuditEvent(user_id=user_id, action=action, ip=client_ip(request),
                      request_id=request_id_var.get(), details=details))
