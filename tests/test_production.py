from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

from sqlalchemy import select

from app import config
from app.models import AuditEvent, IdempotencyKey
from app.routers.auth import auth_rate_limit
from tests.conftest import balance, signup


# ---------- idempotency ----------

def test_idempotent_retry_does_not_repeat_transfer(client):
    ha, a = signup(client)
    hb, b = signup(client, email="bogdan@example.com", name="Bogdan Ion")
    client.post(f"/api/accounts/{a['id']}/deposit", json={"amount": "100"}, headers=ha)

    body = {"from_account_id": a["id"], "to_iban": b["iban"], "amount": "40"}
    headers = {**ha, "Idempotency-Key": "plata-123"}
    first = client.post("/api/transfers", json=body, headers=headers)
    second = client.post("/api/transfers", json=body, headers=headers)

    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    assert second.headers["Idempotent-Replayed"] == "true"
    assert "Idempotent-Replayed" not in first.headers
    assert balance(client, ha, a["id"]) == 60
    assert balance(client, hb, b["id"]) == 40


def test_idempotency_key_reused_with_different_body(client):
    h, acc = signup(client)
    headers = {**h, "Idempotency-Key": "k1"}
    assert client.post(f"/api/accounts/{acc['id']}/deposit", json={"amount": "10"}, headers=headers).status_code == 201
    r = client.post(f"/api/accounts/{acc['id']}/deposit", json={"amount": "11"}, headers=headers)
    assert r.status_code == 422
    assert balance(client, h, acc["id"]) == 10


def test_idempotency_keys_are_scoped_per_user(client):
    ha, a = signup(client)
    hb, b = signup(client, email="bogdan@example.com", name="Bogdan Ion")
    for h, acc in ((ha, a), (hb, b)):
        r = client.post(f"/api/accounts/{acc['id']}/deposit", json={"amount": "5"},
                        headers={**h, "Idempotency-Key": "same"})
        assert r.status_code == 201
        assert "Idempotent-Replayed" not in r.headers


def test_failed_operation_can_be_retried_with_same_key(client, session_factory):
    h, acc = signup(client)
    headers = {**h, "Idempotency-Key": "retry-me"}
    url = f"/api/accounts/{acc['id']}/withdraw"
    assert client.post(url, json={"amount": "50"}, headers=headers).status_code == 400
    with session_factory() as db:
        assert db.scalar(select(IdempotencyKey)) is None
    client.post(f"/api/accounts/{acc['id']}/deposit", json={"amount": "50"}, headers=h)
    assert client.post(url, json={"amount": "50"}, headers=headers).status_code == 201
    assert balance(client, h, acc["id"]) == 0


def test_concurrent_requests_with_same_key_apply_once(client):
    h, acc = signup(client)
    headers = {**h, "Idempotency-Key": "burst"}

    def deposit(_):
        r = client.post(f"/api/accounts/{acc['id']}/deposit", json={"amount": "7"}, headers=headers)
        return r.status_code

    with ThreadPoolExecutor(8) as pool:
        codes = list(pool.map(deposit, range(8)))

    assert set(codes) <= {201, 409}
    assert balance(client, h, acc["id"]) == 7


# ---------- concurrency ----------

def test_opposing_concurrent_transfers_preserve_total(client):
    ha, a = signup(client)
    hb, b = signup(client, email="bogdan@example.com", name="Bogdan Ion")
    client.post(f"/api/accounts/{a['id']}/deposit", json={"amount": "1000"}, headers=ha)
    client.post(f"/api/accounts/{b['id']}/deposit", json={"amount": "1000"}, headers=hb)

    def send(i):
        h, src, dst = (ha, a, b) if i % 2 else (hb, b, a)
        return client.post("/api/transfers", headers=h,
                           json={"from_account_id": src["id"], "to_iban": dst["iban"], "amount": "3"}).status_code

    with ThreadPoolExecutor(10) as pool:
        codes = list(pool.map(send, range(40)))

    assert codes.count(201) == 40
    assert balance(client, ha, a["id"]) + balance(client, hb, b["id"]) == 2000
    assert balance(client, ha, a["id"]) == 1000


def test_large_balances_fit(client):
    h, acc = signup(client)
    for _ in range(3):  # 300M RON > 32-bit range in bani
        assert client.post(f"/api/accounts/{acc['id']}/deposit", json={"amount": "100000000"},
                           headers=h).status_code == 201
    assert balance(client, h, acc["id"]) == Decimal("300000000")


# ---------- brute-force protection ----------

def test_account_locks_after_repeated_failures(client, session_factory):
    signup(client)
    bad = {"email": "ana@example.com", "password": "gresita!!"}
    for _ in range(config.LOGIN_MAX_FAILURES):
        assert client.post("/api/auth/login", json=bad).status_code == 401
    good = {"email": "ana@example.com", "password": "parola-sigura"}
    assert client.post("/api/auth/login", json=good).status_code == 423

    with session_factory() as db:
        actions = db.scalars(select(AuditEvent.action)).all()
    assert actions.count("login.failed") == config.LOGIN_MAX_FAILURES
    assert "user.locked" in actions


def test_successful_login_resets_failure_counter(client):
    signup(client)
    bad = {"email": "ana@example.com", "password": "gresita!!"}
    good = {"email": "ana@example.com", "password": "parola-sigura"}
    for _ in range(config.LOGIN_MAX_FAILURES - 1):
        client.post("/api/auth/login", json=bad)
    assert client.post("/api/auth/login", json=good).status_code == 200
    for _ in range(config.LOGIN_MAX_FAILURES - 1):
        client.post("/api/auth/login", json=bad)
    assert client.post("/api/auth/login", json=good).status_code == 200


def test_auth_endpoints_are_rate_limited(client, monkeypatch):
    monkeypatch.setattr(auth_rate_limit, "limit", 3)
    body = {"email": "x@example.com", "password": "whatever1"}
    codes = [client.post("/api/auth/login", json=body).status_code for _ in range(4)]
    assert codes == [401, 401, 401, 429]


# ---------- audit, observability, health ----------

def test_money_operations_are_audited(client, session_factory):
    h, acc = signup(client)
    r = client.post(f"/api/accounts/{acc['id']}/deposit", json={"amount": "12.34"},
                    headers={**h, "X-Request-ID": "req-abc"})
    assert r.headers["X-Request-ID"] == "req-abc"
    with session_factory() as db:
        event = db.scalar(select(AuditEvent).where(AuditEvent.action == "money.deposit"))
    assert event.details == {"account_id": acc["id"], "amount": 1234, "reference": r.json()["reference"]}
    assert event.request_id == "req-abc"


def test_request_id_generated_when_missing(client):
    assert len(client.get("/health/live").headers["X-Request-ID"]) == 32


def test_health(client):
    assert client.get("/health/live").json() == {"status": "ok"}
    assert client.get("/health/ready").json() == {"status": "ok", "database": "up"}


def test_amounts_serialized_as_strings(client):
    h, acc = signup(client)
    r = client.post(f"/api/accounts/{acc['id']}/deposit", json={"amount": "0.10"}, headers={**h, "Idempotency-Key": "s"})
    assert r.json()["amount"] == "0.10"


# ---------- web app shell ----------

def test_app_shell_and_security_headers(client):
    r = client.get("/")
    assert r.status_code == 200 and "<title>AutoBank</title>" in r.text
    csp = r.headers["Content-Security-Policy"]
    assert "script-src 'self'" in csp and "frame-ancestors 'none'" in csp
    assert r.headers["X-Content-Type-Options"] == "nosniff"

    sw = client.get("/sw.js")
    assert sw.status_code == 200 and sw.headers["content-type"].startswith("text/javascript")
    assert client.get("/static/manifest.webmanifest").json()["display"] == "standalone"
    h, _ = signup(client)
    assert client.get("/api/accounts", headers=h).headers["Cache-Control"] == "no-store"


def test_demo_seed_keeps_ledger_consistent(client, session_factory):
    from sqlalchemy import func

    from app import seed
    from app.models import Account, GoalEntry, SavingsGoal, Transaction

    seed.main(session_factory)
    seed.main(session_factory)  # idempotent: second run is a no-op
    with session_factory() as db:
        for acc in db.scalars(select(Account)):
            total = db.scalar(select(func.coalesce(func.sum(Transaction.amount), 0)).where(Transaction.account_id == acc.id))
            assert acc.balance == total, acc.name
        for goal in db.scalars(select(SavingsGoal)):
            total = db.scalar(select(func.coalesce(func.sum(GoalEntry.amount), 0)).where(GoalEntry.goal_id == goal.id))
            assert goal.balance == total, goal.name

    r = client.post("/api/auth/login", json={"email": seed.EMAIL, "password": seed.PASSWORD})
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}
    accounts = client.get("/api/accounts", headers=h).json()
    stats = client.get("/api/stats", params={"account_id": accounts[0]["id"]}, headers=h).json()
    assert sum(Decimal(m["expenses"]) for m in stats["months"]) > 0
    assert len(client.get("/api/goals", headers=h).json()) == 3
    assert len(client.get("/api/cards", headers=h).json()) == 1
