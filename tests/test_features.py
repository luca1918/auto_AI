from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import select

from app import cards as cards_lib
from app.banking import month_start
from app.models import AuditEvent, Transaction
from tests.conftest import balance, signup


def fund(client, h, acc, amount="1000"):
    assert client.post(f"/api/accounts/{acc['id']}/deposit", json={"amount": amount}, headers=h).status_code == 201


def new_goal(client, h, acc, **kw):
    body = {"account_id": acc["id"], "name": "Vacanță", "emoji": "🏖️", "target": "500", **kw}
    r = client.post("/api/goals", json=body, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def new_card(client, h, acc):
    r = client.post("/api/cards", json={"account_id": acc["id"]}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()


def pay(client, h, card, amount, merchant="Mega Image", category="groceries", **headers):
    return client.post(f"/api/cards/{card['id']}/payments", headers={**h, **headers},
                       json={"merchant": merchant, "amount": amount, "category": category})


# ---------- savings goals ----------

def test_goal_lifecycle(client):
    h, acc = signup(client)
    fund(client, h, acc)
    goal = new_goal(client, h, acc)
    assert goal["currency"] == "RON" and Decimal(goal["balance"]) == 0

    r = client.post(f"/api/goals/{goal['id']}/deposit", json={"amount": "200"}, headers=h)
    assert r.status_code == 201 and Decimal(r.json()["balance_after"]) == 200
    assert client.post(f"/api/goals/{goal['id']}/withdraw", json={"amount": "50"}, headers=h).status_code == 201
    assert client.post(f"/api/goals/{goal['id']}/withdraw", json={"amount": "500"}, headers=h).status_code == 400
    assert client.post(f"/api/goals/{goal['id']}/deposit", json={"amount": "5000"}, headers=h).status_code == 400

    assert Decimal(client.get(f"/api/goals/{goal['id']}", headers=h).json()["balance"]) == 150
    assert balance(client, h, acc["id"]) == 850
    kinds = [e["kind"] for e in client.get(f"/api/goals/{goal['id']}/entries", headers=h).json()]
    assert kinds == ["withdrawal", "deposit"]

    txs = client.get(f"/api/accounts/{acc['id']}/transactions", headers=h).json()
    assert {t["kind"] for t in txs[:2]} == {"to_savings", "from_savings"}
    assert all(t["category"] == "savings" and t["goal_id"] == goal["id"] for t in txs[:2])

    closed = client.delete(f"/api/goals/{goal['id']}", headers=h)
    assert closed.status_code == 200 and closed.json()["closed_at"]
    assert balance(client, h, acc["id"]) == 1000
    assert client.get(f"/api/goals/{goal['id']}", headers=h).status_code == 404
    assert client.get("/api/goals", headers=h).json() == []


def test_goal_update_and_single_roundup_goal(client):
    h, acc = signup(client)
    g1 = new_goal(client, h, acc, roundup_enabled=True)
    g2 = new_goal(client, h, acc, name="Laptop")
    r = client.patch(f"/api/goals/{g2['id']}", json={"roundup_enabled": True, "target": "3000", "emoji": "💻"},
                     headers=h)
    assert r.status_code == 200 and r.json()["roundup_enabled"] and Decimal(r.json()["target"]) == 3000
    assert client.get(f"/api/goals/{g1['id']}", headers=h).json()["roundup_enabled"] is False


def test_goals_are_private(client):
    ha, a = signup(client)
    hb, _ = signup(client, email="bogdan@example.com", name="Bogdan Ion")
    goal = new_goal(client, ha, a)
    assert client.get(f"/api/goals/{goal['id']}", headers=hb).status_code == 404
    assert client.post(f"/api/goals/{goal['id']}/deposit", json={"amount": "1"}, headers=hb).status_code == 404
    assert client.post("/api/goals", json={"account_id": a["id"], "name": "x", "target": "1"},
                       headers=hb).status_code == 404


def test_goal_deposit_is_idempotent(client):
    h, acc = signup(client)
    fund(client, h, acc)
    goal = new_goal(client, h, acc)
    for _ in range(2):
        client.post(f"/api/goals/{goal['id']}/deposit", json={"amount": "10"}, headers={**h, "Idempotency-Key": "g"})
    assert balance(client, h, acc["id"]) == 990


# ---------- cards ----------

def test_card_issue_and_details(client, session_factory):
    h, acc = signup(client)
    card = new_card(client, h, acc)
    assert card["holder_name"] == "Ana Pop" and card["frozen"] is False and len(card["last4"]) == 4
    details = client.get(f"/api/cards/{card['id']}/details", headers=h).json()
    assert cards_lib.luhn_valid(details["pan"]) and details["pan"].endswith(card["last4"])
    assert len(details["cvv"]) == 3
    with session_factory() as db:
        assert db.scalar(select(AuditEvent).where(AuditEvent.action == "card.details_viewed")) is not None
        stored = db.scalar(select(Transaction.id))  # nothing charged by issuing a card
        assert stored is None


def test_card_payment_freeze_and_limit(client):
    h, acc = signup(client)
    fund(client, h, acc, "500")
    card = new_card(client, h, acc)

    r = pay(client, h, card, "45.50")
    assert r.status_code == 201
    tx = r.json()
    assert tx["kind"] == "card_payment" and tx["category"] == "groceries" and tx["counterparty_name"] == "Mega Image"
    assert tx["card_id"] == card["id"]

    assert client.patch(f"/api/cards/{card['id']}", json={"frozen": True}, headers=h).json()["frozen"]
    assert pay(client, h, card, "1").json()["detail"] == "Cardul este înghețat"
    client.patch(f"/api/cards/{card['id']}", json={"frozen": False, "monthly_limit": "100"}, headers=h)

    assert pay(client, h, card, "60").status_code == 400  # 45.50 + 60 > 100
    assert pay(client, h, card, "54.50").status_code == 201
    info = client.get(f"/api/cards/{card['id']}", headers=h).json()
    assert Decimal(info["spent_this_month"]) == 100 and Decimal(info["monthly_limit"]) == 100

    r = client.patch(f"/api/cards/{card['id']}", json={"monthly_limit": None}, headers=h)
    assert r.json()["monthly_limit"] is None
    assert pay(client, h, card, "1000").json()["detail"] == "Fonduri insuficiente"
    assert len(client.get(f"/api/cards/{card['id']}/transactions", headers=h).json()) == 2


def test_card_payment_invalid_category(client):
    h, acc = signup(client)
    card = new_card(client, h, acc)
    assert pay(client, h, card, "1", category="savings").status_code == 422


def test_concurrent_card_payments_respect_limit(client):
    h, acc = signup(client)
    fund(client, h, acc, "1000")
    card = new_card(client, h, acc)
    client.patch(f"/api/cards/{card['id']}", json={"monthly_limit": "100"}, headers=h)
    with ThreadPoolExecutor(8) as pool:
        codes = list(pool.map(lambda _: pay(client, h, card, "30").status_code, range(8)))
    assert codes.count(201) == 3
    assert balance(client, h, acc["id"]) == 910


def test_closed_card(client):
    h, acc = signup(client)
    card = new_card(client, h, acc)
    assert client.delete(f"/api/cards/{card['id']}", headers=h).status_code == 204
    assert client.get("/api/cards", headers=h).json() == []
    assert pay(client, h, card, "1").status_code == 404


def test_roundup_moves_spare_change(client):
    h, acc = signup(client)
    fund(client, h, acc, "100")
    goal = new_goal(client, h, acc, roundup_enabled=True)
    card = new_card(client, h, acc)

    pay(client, h, card, "12.30")  # rounds up by 0.70
    pay(client, h, card, "5")      # already whole, no round-up
    assert Decimal(client.get(f"/api/goals/{goal['id']}", headers=h).json()["balance"]) == Decimal("0.70")
    assert balance(client, h, acc["id"]) == Decimal("82.00")
    entries = client.get(f"/api/goals/{goal['id']}/entries", headers=h).json()
    assert [e["kind"] for e in entries] == ["roundup"]


def test_roundup_skipped_when_funds_too_low(client):
    h, acc = signup(client)
    fund(client, h, acc, "10.20")
    goal = new_goal(client, h, acc, roundup_enabled=True)
    card = new_card(client, h, acc)
    assert pay(client, h, card, "10.10").status_code == 201  # 0.10 left, 0.90 round-up unaffordable
    assert Decimal(client.get(f"/api/goals/{goal['id']}", headers=h).json()["balance"]) == 0


# ---------- beneficiaries ----------

def test_beneficiaries_crud(client):
    ha, a = signup(client)
    hb, b = signup(client, email="bogdan@example.com", name="Bogdan Ion")
    spaced = " ".join(b["iban"][i:i + 4] for i in range(0, 24, 4))
    r = client.post("/api/beneficiaries", json={"name": "Bogdan", "iban": spaced}, headers=ha)
    assert r.status_code == 201 and r.json()["iban"] == b["iban"]
    ben = r.json()
    assert client.post("/api/beneficiaries", json={"name": "Dublu", "iban": b["iban"]}, headers=ha).status_code == 409
    assert client.post("/api/beneficiaries", json={"name": "Rău", "iban": "RO00XXXX0000000000000000"},
                       headers=ha).status_code == 422
    assert client.patch(f"/api/beneficiaries/{ben['id']}", json={"name": "Bogdan I."}, headers=ha).json()["name"] == "Bogdan I."
    assert client.delete(f"/api/beneficiaries/{ben['id']}", headers=hb).status_code == 404
    assert client.get("/api/beneficiaries", headers=hb).json() == []
    assert client.delete(f"/api/beneficiaries/{ben['id']}", headers=ha).status_code == 204
    assert client.get("/api/beneficiaries", headers=ha).json() == []


# ---------- transfers, search, statement ----------

def test_transfer_records_counterparty_and_category(client):
    ha, a = signup(client)
    hb, b = signup(client, email="bogdan@example.com", name="Bogdan Ion")
    fund(client, ha, a)
    savings = client.post("/api/accounts", json={"name": "Economii", "currency": "RON"}, headers=ha).json()

    out = client.post("/api/transfers", headers=ha, json={"from_account_id": a["id"], "to_iban": b["iban"],
                                                          "amount": "10", "description": "Pizza"}).json()
    assert out["counterparty_name"] == "Bogdan Ion" and out["category"] == "transfers"
    incoming = client.get(f"/api/accounts/{b['id']}/transactions", headers=hb).json()[0]
    assert incoming["counterparty_name"] == "Ana Pop"

    own = client.post("/api/transfers", headers=ha, json={"from_account_id": a["id"], "to_iban": savings["iban"],
                                                          "amount": "5"}).json()
    assert own["category"] == "internal" and own["counterparty_name"] == "Economii"


def test_search_transactions(client):
    ha, a = signup(client)
    hb, b = signup(client, email="bogdan@example.com", name="Bogdan Ion")
    fund(client, ha, a)
    fund(client, hb, b)
    card = new_card(client, ha, a)
    pay(client, ha, card, "23.45", merchant="Cafeneaua 100%", category="restaurants")
    pay(client, ha, card, "60", merchant="Bilete CFR", category="transport")
    client.post("/api/transfers", headers=ha, json={"from_account_id": a["id"], "to_iban": b["iban"], "amount": "7"})
    card_b = new_card(client, hb, b)
    pay(client, hb, card_b, "1", merchant="Cafeneaua secretă", category="restaurants")

    def search(**params):
        return client.get("/api/transactions", params=params, headers=ha).json()

    assert [t["counterparty_name"] for t in search(q="cafeneaua")] == ["Cafeneaua 100%"]
    assert len(search(q="100%")) == 1 and search(q="%") == search(q="100%")
    assert [t["counterparty_name"] for t in search(q="bogdan")] == ["Bogdan Ion"]
    assert [t["amount"] for t in search(q="23,45")] == ["-23.45"]
    assert [t["counterparty_name"] for t in search(category="transport")] == ["Bilete CFR"]
    assert len(search(account_id=a["id"])) == 4
    assert search(account_id=b["id"]) == []


def test_statement_csv(client):
    ha, a = signup(client)
    hb, b = signup(client, email="bogdan@example.com", name="Bogdan Ion")
    fund(client, hb, b)
    client.post("/api/transfers", headers=hb, json={"from_account_id": b["id"], "to_iban": a["iban"],
                                                    "amount": "12.5", "description": "=HYPERLINK(\"x\")"})
    r = client.get(f"/api/accounts/{a['id']}/statement.csv", headers=ha)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    lines = r.content.decode("utf-8-sig").splitlines()
    assert lines[0].startswith("Data;Tip;Descriere")
    assert "'=HYPERLINK" in lines[1] and ";12,50;12,50;" in lines[1]
    assert client.get(f"/api/accounts/{a['id']}/statement.csv", headers=hb).status_code == 404
    future = (datetime.now() + timedelta(days=5)).date().isoformat()
    only_header = client.get(f"/api/accounts/{a['id']}/statement.csv", params={"from": future}, headers=ha)
    assert len(only_header.content.decode("utf-8-sig").splitlines()) == 1


# ---------- statistics ----------

def test_stats_by_month_and_category(client, session_factory):
    h, acc = signup(client)
    fund(client, h, acc, "2000")
    card = new_card(client, h, acc)
    pay(client, h, card, "100", category="groceries")
    pay(client, h, card, "50", category="groceries")
    pay(client, h, card, "150", merchant="Uber", category="transport")
    goal = new_goal(client, h, acc)
    client.post(f"/api/goals/{goal['id']}/deposit", json={"amount": "300"}, headers=h)  # not spending
    savings = client.post("/api/accounts", json={"name": "Economii"}, headers=h).json()
    client.post("/api/transfers", headers=h, json={"from_account_id": acc["id"], "to_iban": savings["iban"],
                                                   "amount": "400"})  # internal, not spending

    # A payment backdated into the middle of the previous month.
    with session_factory() as db:
        db.add(Transaction(account_id=acc["id"], kind="card_payment", amount=-8000, balance_after=0,
                           category="restaurants", description="old", reference="old",
                           created_at=month_start() - timedelta(days=15)))
        db.commit()

    s = client.get("/api/stats", params={"account_id": acc["id"]}, headers=h).json()
    assert s["currency"] == "RON" and len(s["months"]) == 6
    assert Decimal(s["total_expenses"]) == 300 and Decimal(s["total_income"]) == 2000
    assert [(c["category"], c["amount"], c["count"]) for c in s["categories"]] == [
        ("groceries", "150.00", 2), ("transport", "150.00", 1)]
    assert s["categories"][0]["share"] == 0.5
    assert sum(Decimal(m["expenses"]) for m in s["months"]) == 380
    assert s["months"][-1]["month"] == s["month"]

    prev = s["months"][-2]["month"]
    p = client.get("/api/stats", params={"account_id": acc["id"], "month": prev, "months": 3}, headers=h).json()
    assert len(p["months"]) == 3 and p["month"] == prev
    assert [c["category"] for c in p["categories"]] == ["restaurants"] and Decimal(p["total_expenses"]) == 80

    assert client.get("/api/stats", params={"account_id": acc["id"], "month": "2026-13"}, headers=h).status_code == 422


# ---------- profile ----------

def test_change_password_and_rename_account(client):
    h, acc = signup(client)
    bad = client.post("/api/auth/change-password", json={"current_password": "nu", "new_password": "noua-parola"},
                      headers=h)
    assert bad.status_code == 400
    ok = client.post("/api/auth/change-password",
                     json={"current_password": "parola-sigura", "new_password": "noua-parola"}, headers=h)
    assert ok.status_code == 204
    assert client.post("/api/auth/login", json={"email": "ana@example.com", "password": "noua-parola"}).status_code == 200
    assert client.patch(f"/api/accounts/{acc['id']}", json={"name": "Principal"}, headers=h).json()["name"] == "Principal"
