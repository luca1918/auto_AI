from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

from tests.conftest import signup


def test_register_creates_ron_account(client):
    _, account = signup(client)
    assert account["currency"] == "RON"
    assert Decimal(account["balance"]) == 0


def test_duplicate_email_rejected(client):
    signup(client)
    r = client.post("/api/auth/register", json={"email": "ANA@example.com", "full_name": "X Y", "password": "12345678"})
    assert r.status_code == 409


def test_login_wrong_password(client):
    signup(client)
    r = client.post("/api/auth/login", json={"email": "ana@example.com", "password": "gresita!!"})
    assert r.status_code == 401


def test_requires_auth(client):
    assert client.get("/api/accounts").status_code == 401
    assert client.get("/api/accounts", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_deposit_withdraw_and_history(client):
    h, acc = signup(client)
    assert client.post(f"/api/accounts/{acc['id']}/deposit", json={"amount": "100.50"}, headers=h).status_code == 201
    r = client.post(f"/api/accounts/{acc['id']}/withdraw", json={"amount": "40.25"}, headers=h)
    assert r.status_code == 201
    assert Decimal(r.json()["balance_after"]) == Decimal("60.25")

    r = client.post(f"/api/accounts/{acc['id']}/withdraw", json={"amount": "1000"}, headers=h)
    assert r.status_code == 400 and "insuficiente" in r.json()["detail"]

    txs = client.get(f"/api/accounts/{acc['id']}/transactions", headers=h).json()
    assert [t["kind"] for t in txs] == ["withdrawal", "deposit"]
    assert Decimal(client.get(f"/api/accounts/{acc['id']}", headers=h).json()["balance"]) == Decimal("60.25")


def test_invalid_amounts(client):
    h, acc = signup(client)
    for amount in ["0", "-1", "1.001"]:
        r = client.post(f"/api/accounts/{acc['id']}/deposit", json={"amount": amount}, headers=h)
        assert r.status_code == 422, amount


def test_transfer_between_users(client):
    ha, a = signup(client)
    hb, b = signup(client, email="bogdan@example.com", name="Bogdan Ion")
    client.post(f"/api/accounts/{a['id']}/deposit", json={"amount": "500"}, headers=ha)

    iban_with_spaces = " ".join(b["iban"][i:i + 4] for i in range(0, 24, 4)).lower()
    r = client.post("/api/transfers", headers=ha, json={
        "from_account_id": a["id"], "to_iban": iban_with_spaces, "amount": "123.45", "description": "Chirie"})
    assert r.status_code == 201, r.text

    assert Decimal(client.get(f"/api/accounts/{a['id']}", headers=ha).json()["balance"]) == Decimal("376.55")
    assert Decimal(client.get(f"/api/accounts/{b['id']}", headers=hb).json()["balance"]) == Decimal("123.45")
    incoming = client.get(f"/api/accounts/{b['id']}/transactions", headers=hb).json()[0]
    assert incoming["kind"] == "transfer_in" and incoming["counterparty_iban"] == a["iban"]
    assert incoming["reference"] == r.json()["reference"]


def test_transfer_failures_leave_balances_untouched(client):
    ha, a = signup(client)
    hb, b = signup(client, email="bogdan@example.com", name="Bogdan Ion")
    client.post(f"/api/accounts/{a['id']}/deposit", json={"amount": "10"}, headers=ha)

    def send(**kw):
        body = {"from_account_id": a["id"], "to_iban": b["iban"], "amount": "5", **kw}
        return client.post("/api/transfers", headers=ha, json=body)

    assert send(amount="50").status_code == 400            # insufficient funds
    assert send(to_iban="RO00XXXX0000000000000000").status_code == 400  # bad checksum
    assert send(to_iban=a["iban"]).status_code == 400       # same account
    eur = client.post("/api/accounts", headers=hb, json={"name": "Euro", "currency": "EUR"}).json()
    assert send(to_iban=eur["iban"]).status_code == 400     # currency mismatch

    assert Decimal(client.get(f"/api/accounts/{a['id']}", headers=ha).json()["balance"]) == 10
    assert Decimal(client.get(f"/api/accounts/{b['id']}", headers=hb).json()["balance"]) == 0


def test_cannot_use_someone_elses_account(client):
    ha, a = signup(client)
    hb, b = signup(client, email="bogdan@example.com", name="Bogdan Ion")
    assert client.get(f"/api/accounts/{a['id']}", headers=hb).status_code == 404
    assert client.get(f"/api/accounts/{a['id']}/transactions", headers=hb).status_code == 404
    assert client.post(f"/api/accounts/{a['id']}/withdraw", json={"amount": "1"}, headers=hb).status_code == 404
    r = client.post("/api/transfers", headers=hb, json={"from_account_id": a["id"], "to_iban": b["iban"], "amount": "1"})
    assert r.status_code == 404


def test_concurrent_withdrawals_never_overdraw(client):
    h, acc = signup(client)
    client.post(f"/api/accounts/{acc['id']}/deposit", json={"amount": "100"}, headers=h)

    def withdraw(_):
        return client.post(f"/api/accounts/{acc['id']}/withdraw", json={"amount": "30"}, headers=h).status_code

    with ThreadPoolExecutor(8) as pool:
        codes = list(pool.map(withdraw, range(10)))

    assert codes.count(201) == 3
    assert Decimal(client.get(f"/api/accounts/{acc['id']}", headers=h).json()["balance"]) == 10
