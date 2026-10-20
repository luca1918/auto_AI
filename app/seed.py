"""Creates a demo customer with six months of realistic history.

    python -m app.seed            # demo@autobank.ro / demo1234
"""

import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from app import banking, cards as cards_lib, config, iban
from app.db import SessionLocal
from app.models import Account, Beneficiary, Card, GoalEntry, SavingsGoal, Transaction, User
from app.security import hash_password

EMAIL = "demo@autobank.ro"
PASSWORD = "demo1234"

MERCHANTS = {
    "groceries": [("Supermarket Proxi", 40, 260), ("Piața Obor", 25, 120), ("Brutăria din colț", 8, 35)],
    "restaurants": [("Cafeneaua Boemă", 14, 38), ("Bistro Central", 60, 180), ("Pizzeria Napoli", 45, 120)],
    "transport": [("Taxi Rapid", 18, 60), ("Benzinărie", 150, 320), ("Abonament metrou", 80, 80)],
    "shopping": [("Librăria Cărturești", 40, 150), ("Magazin haine", 120, 420), ("Electronice Online", 90, 600)],
    "entertainment": [("Cinema City", 35, 90), ("Streaming muzică", 25, 25), ("Concert", 120, 250)],
    "bills": [("Factură energie", 180, 320), ("Internet & TV", 65, 65), ("Telefonie mobilă", 45, 55)],
    "health": [("Farmacia Verde", 25, 140), ("Sală de sport", 160, 160)],
    "travel": [("Cazare Brașov", 380, 900), ("Bilete tren", 70, 160)],
}
WEIGHTS = {"groceries": 9, "restaurants": 6, "transport": 5, "shopping": 2, "entertainment": 2, "bills": 0,
           "health": 2, "travel": 0}


def _user(db, email, name):
    user = User(email=email, full_name=name, password_hash=hash_password(PASSWORD))
    db.add(user)
    db.flush()
    return user


def _account(db, user, name, currency="RON"):
    acc = Account(owner_id=user.id, iban=iban.generate_ro(), name=name, currency=currency, balance=0)
    db.add(acc)
    db.flush()
    return acc


def _stamp(db, reference, when):
    db.execute(update(Transaction).where(Transaction.reference == reference).values(created_at=when))
    db.execute(update(GoalEntry).where(GoalEntry.reference == reference).values(created_at=when))


def main(session_factory=SessionLocal) -> None:
    if config.ENVIRONMENT == "production":
        # The demo users have a published password.
        raise SystemExit("Datele demo nu se creează în producție (BANK_ENV=production).")
    with session_factory() as db:
        if db.scalar(select(User).where(User.email == EMAIL)):
            print(f"Utilizatorul demo există deja: {EMAIL} / {PASSWORD}")
            return
        _populate(db)
    print(f"Gata. Intră cu {EMAIL} / {PASSWORD}")


def _populate(db) -> None:
    rnd = random.Random(42)

    luca = _user(db, EMAIL, "Luca Ionescu")
    main_acc = _account(db, luca, "Cont curent")
    savings_acc = _account(db, luca, "Economii")
    eur_acc = _account(db, luca, "Vacanțe", "EUR")
    maria = _user(db, "maria@autobank.ro", "Maria Popescu")
    maria_acc = _account(db, maria, "Cont curent")
    landlord = _user(db, "proprietar@autobank.ro", "Andrei Stan")
    landlord_acc = _account(db, landlord, "Chirii")
    employer = _user(db, "salarii@autobank.ro", "Tech Solutions SRL")
    employer_acc = _account(db, employer, "Salarii")

    db.add_all([Beneficiary(owner_id=luca.id, name="Maria Popescu", iban=maria_acc.iban),
                Beneficiary(owner_id=luca.id, name="Andrei (chirie)", iban=landlord_acc.iban)])
    data = cards_lib.generate()
    card = Card(owner_id=luca.id, account_id=main_acc.id, label="Card cumpărături", last4=data["pan"][-4:],
                expiry_month=data["expiry_month"], expiry_year=data["expiry_year"],
                secret=cards_lib.encrypt(data["pan"], data["cvv"]), frozen=False, monthly_limit=400000)
    db.add(card)
    goals = [SavingsGoal(owner_id=luca.id, account_id=main_acc.id, name=n, emoji=e, target=t, balance=0,
                         roundup_enabled=r) for n, e, t, r in [
        ("Vacanță la mare", "🏖️", 400000, True), ("Laptop nou", "💻", 650000, False),
        ("Fond de urgență", "🎯", 1500000, False)]]
    db.add_all(goals)
    db.commit()

    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=170)).replace(hour=9, minute=0, second=0, microsecond=0)
    banking.deposit(db, employer_acc, 100_000_000, "Capital")
    banking.deposit(db, maria_acc, 2_000_000)
    banking.deposit(db, eur_acc, 85_000, "Schimb valutar")
    db.commit()

    events = []
    day = start
    while day < now:
        if day.day == 5:
            events.append((day.replace(hour=10), "salary"))
            events.append((day.replace(hour=12), "rent"))
            events.append((day.replace(hour=18), "goals"))
        if day.day == 12:
            events.append((day.replace(hour=11), "bills"))
        if day.day == 20 and rnd.random() < 0.6:
            events.append((day.replace(hour=20), "from_maria"))
        if day.day == 25:
            events.append((day.replace(hour=9), "move"))
        for _ in range(rnd.choice([0, 1, 1, 2])):
            events.append((day.replace(hour=rnd.randint(8, 21), minute=rnd.randint(0, 59)), "card"))
        day += timedelta(days=1)

    for when, kind in sorted(events):
        if when >= now:
            continue
        try:
            if kind == "salary":
                tx = banking.transfer(db, employer_acc, main_acc.iban, rnd.randint(7200, 7800) * 100, "Salariu")
            elif kind == "rent":
                tx = banking.transfer(db, main_acc, landlord_acc.iban, 220_000, "Chirie")
            elif kind == "goals":
                refs = [banking.goal_deposit(db, goals[0], 40_000).reference,
                        banking.goal_deposit(db, goals[1], 50_000).reference,
                        banking.goal_deposit(db, goals[2], 30_000).reference]
                for ref in refs:
                    _stamp(db, ref, when)
                db.commit()
                continue
            elif kind == "bills":
                for merchant, lo, hi in MERCHANTS["bills"]:
                    tx = banking.card_payment(db, card, merchant, rnd.randint(lo, hi) * 100 + rnd.choice([0, 49, 99]), "bills")
                    _stamp(db, tx.reference, when)
                db.commit()
                continue
            elif kind == "from_maria":
                tx = banking.transfer(db, maria_acc, main_acc.iban, rnd.choice([5000, 7500, 12000]), "Pizza de vineri")
            elif kind == "move":
                tx = banking.transfer(db, main_acc, savings_acc.iban, 30_000, "Pus deoparte")
            else:
                cat = rnd.choices(list(WEIGHTS), weights=list(WEIGHTS.values()))[0]
                merchant, lo, hi = rnd.choice(MERCHANTS[cat])
                amount = rnd.randint(lo * 100, hi * 100)
                tx = banking.card_payment(db, card, merchant, amount, cat)
            _stamp(db, tx.reference, when)
            db.commit()
        except banking.BankingError:
            db.rollback()


if __name__ == "__main__":
    main()
