from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import observability
from app.routers import accounts, auth, health

STATIC_DIR = Path(__file__).parent / "static"

observability.setup_logging()

# The schema is managed by Alembic: run `alembic upgrade head` before starting.
app = FastAPI(title="AutoBank", version="0.2.0")
observability.install(app)
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(accounts.router)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "index.html")
