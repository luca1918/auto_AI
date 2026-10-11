import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

from app.observability import client_ip


class RateLimiter:
    """Sliding-window limiter keyed by client IP.

    In-process only: with several workers/instances each enforces its own window,
    so put a shared limiter (e.g. Redis or the reverse proxy) in front for real deployments."""

    def __init__(self, limit: int, window_seconds: float = 60.0):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def __call__(self, request: Request) -> None:
        key = client_ip(request) or "unknown"
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and hits[0] <= now - self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                retry = int(hits[0] + self.window - now) + 1
                raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Prea multe încercări. Reîncearcă mai târziu.",
                                    headers={"Retry-After": str(retry)})
            hits.append(now)

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()
