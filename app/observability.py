"""JSON logging and a request-id middleware shared by logs, audit events and error responses."""

import json
import logging
import time
import uuid
from contextvars import ContextVar

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.config import LOG_LEVEL

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
logger = logging.getLogger("bank")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        payload.update(getattr(record, "extra_fields", {}))
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def setup_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger("bank")
    root.handlers[:] = [handler]
    root.setLevel(LOG_LEVEL)
    root.propagate = False


def log(level: int, msg: str, **fields) -> None:
    logger.log(level, msg, extra={"extra_fields": fields})


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def install(app: FastAPI) -> None:
    @app.middleware("http")
    async def request_context(request: Request, call_next):
        incoming = request.headers.get("X-Request-ID", "")
        rid = incoming if 0 < len(incoming) <= 64 and incoming.isprintable() else uuid.uuid4().hex
        token = request_id_var.set(rid)
        start = time.perf_counter()
        try:
            try:
                response = await call_next(request)
            except Exception:
                logger.exception("unhandled_exception")
                response = JSONResponse({"detail": "Eroare internă", "request_id": rid}, status_code=500)
            response.headers["X-Request-ID"] = rid
            log(logging.INFO, "request", method=request.method, path=request.url.path,
                status=response.status_code, duration_ms=round((time.perf_counter() - start) * 1000, 1),
                ip=client_ip(request))
            return response
        finally:
            request_id_var.reset(token)
