import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.db import Base, get_db, make_engine
from app.main import app
from app.routers.auth import auth_rate_limit

# Set BANK_TEST_DATABASE_URL (e.g. postgresql+psycopg://bank:bank@localhost/bank_test)
# to run the suite against PostgreSQL; defaults to a throwaway SQLite file.
TEST_DB_URL = os.getenv("BANK_TEST_DATABASE_URL")


@pytest.fixture()
def engine(tmp_path):
    engine = make_engine(TEST_DB_URL or f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield engine
    Base.metadata.drop_all(engine)
    engine.dispose()


@pytest.fixture()
def session_factory(engine):
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


@pytest.fixture()
def client(session_factory):
    def _get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _get_db
    auth_rate_limit.reset()
    yield TestClient(app)
    app.dependency_overrides.clear()


def signup(client, email="ana@example.com", name="Ana Pop", password="parola-sigura"):
    r = client.post("/api/auth/register", json={"email": email, "full_name": name, "password": password})
    assert r.status_code == 201, r.text
    token = client.post("/api/auth/login", json={"email": email, "password": password}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    account = client.get("/api/accounts", headers=headers).json()[0]
    return headers, account


def balance(client, headers, account_id):
    from decimal import Decimal
    return Decimal(client.get(f"/api/accounts/{account_id}", headers=headers).json()["balance"])
