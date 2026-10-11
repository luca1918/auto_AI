# AutoBank

Aplicație bancară demo: backend FastAPI + SQLite și o interfață web în română.

## Funcționalități

- Înregistrare / autentificare (parole bcrypt, token JWT)
- Cont curent RON creat automat; se pot deschide conturi în RON, EUR, USD (max. 10)
- IBAN-uri românești generate cu cifre de control valide (mod 97)
- Depuneri, retrageri și transferuri între clienți pe baza IBAN-ului
- Istoric tranzacții cu referință comună pentru cele două capete ale unui transfer
- Sumele sunt stocate în subunități (bani/cenți) – fără erori de virgulă mobilă
- Debitările folosesc `UPDATE ... WHERE balance >= suma`, deci soldul nu poate deveni negativ nici la cereri concurente

## Pornire

```bash
pip install -r requirements.txt
export BANK_SECRET_KEY="schimba-ma"   # opțional; altfel tokenurile expiră la restart
uvicorn app.main:app --reload
```

Deschide http://localhost:8000 pentru aplicație și http://localhost:8000/docs pentru documentația API.

## Teste

```bash
pytest
```

## API

| Metodă | Rută | Descriere |
|---|---|---|
| POST | `/api/auth/register` | cont nou de client |
| POST | `/api/auth/login` | returnează token JWT |
| GET | `/api/auth/me` | utilizatorul curent |
| GET / POST | `/api/accounts` | listează / deschide conturi |
| GET | `/api/accounts/{id}` | detalii cont |
| GET | `/api/accounts/{id}/transactions` | istoric (`limit`, `offset`) |
| POST | `/api/accounts/{id}/deposit` | depunere `{amount, description}` |
| POST | `/api/accounts/{id}/withdraw` | retragere `{amount, description}` |
| POST | `/api/transfers` | transfer `{from_account_id, to_iban, amount, description}` |

## Variabile de mediu

- `BANK_DATABASE_URL` – implicit `sqlite:///./bank.db`
- `BANK_SECRET_KEY` – cheia de semnare JWT
- `BANK_TOKEN_TTL_MINUTES` – implicit 30

## Limitări (demo)

Depunerile/retragerile sunt simulate, nu există schimb valutar între monede,
rate limiting, 2FA sau migrații de bază de date (tabelele se creează la pornire).
