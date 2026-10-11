# AutoBank

Aplicație bancară demo: backend FastAPI + PostgreSQL (sau SQLite local) și o interfață web în română.

## Funcționalități

- Înregistrare / autentificare (parole bcrypt, token JWT)
- Cont curent RON creat automat; se pot deschide conturi în RON, EUR, USD (max. 10)
- IBAN-uri românești generate cu cifre de control valide (mod 97)
- Depuneri, retrageri și transferuri între clienți pe baza IBAN-ului
- Istoric tranzacții cu referință comună pentru cele două capete ale unui transfer
- Sumele sunt stocate în subunități (bani/cenți) – fără erori de virgulă mobilă
- Debitările folosesc `UPDATE ... WHERE balance >= suma`, deci soldul nu poate deveni negativ nici la cereri concurente
- Transferurile blochează ambele conturi în ordinea id-urilor, deci transferurile opuse simultane nu intră în deadlock

### Pregătire pentru producție

- **Idempotență**: header-ul `Idempotency-Key` pe depuneri, retrageri și transferuri. O reîncercare cu aceeași
  cheie returnează răspunsul inițial (`Idempotent-Replayed: true`) fără a muta banii din nou; aceeași cheie cu
  alt conținut → `422`. Operațiunile eșuate nu sunt memorate, deci pot fi reîncercate.
- **Protecție brute-force**: contul se blochează 15 minute după 5 parole greșite (`423`), iar rutele de
  autentificare sunt limitate per IP (`429`, implicit 20/minut, în memoria procesului).
- **Audit log** (`audit_events`): înregistrări, login-uri reușite/eșuate, blocări, conturi deschise și fiecare
  operațiune cu bani, cu IP și request id. Evenimentul se salvează în aceeași tranzacție cu operațiunea.
- **Loguri JSON** cu `request_id`; header-ul `X-Request-ID` e preluat de la client sau generat și returnat.
- **Health checks**: `/health/live` și `/health/ready` (verifică baza de date).
- **Migrații Alembic**; sumele sunt `BIGINT`.
- Cu `BANK_ENV=production`, aplicația refuză să pornească fără `BANK_SECRET_KEY`.

## Pornire cu Docker (PostgreSQL)

```bash
echo "BANK_SECRET_KEY=$(openssl rand -hex 32)" > .env
docker compose up --build
```

Containerul aplică migrațiile la pornire.

## Pornire locală

```bash
pip install -r requirements-dev.txt
export BANK_DATABASE_URL=sqlite:///./bank.db      # sau postgresql+psycopg://user:pass@host/db
alembic upgrade head
uvicorn app.main:app --reload
```

După modificarea modelelor: `alembic revision --autogenerate -m "descriere"`.

Deschide http://localhost:8000 pentru aplicație și http://localhost:8000/docs pentru documentația API.

## Teste

```bash
pytest                                                                         # SQLite
BANK_TEST_DATABASE_URL=postgresql+psycopg://bank:bank@localhost/bank_test pytest   # PostgreSQL
```

Atenție: suita șterge și recreează tabelele din baza de test.

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
| GET | `/health/live`, `/health/ready` | health checks |

Rutele care mută bani acceptă header-ul opțional `Idempotency-Key`.

## Variabile de mediu

- `BANK_DATABASE_URL` – implicit `sqlite:///./bank.db`
- `BANK_SECRET_KEY` – cheia de semnare JWT
- `BANK_ENV` – `development` (implicit) sau `production`
- `BANK_TOKEN_TTL_MINUTES` – implicit 30
- `BANK_LOGIN_MAX_FAILURES` / `BANK_LOGIN_LOCK_MINUTES` – implicit 5 / 15
- `BANK_AUTH_RATE_LIMIT_PER_MINUTE` – implicit 20
- `BANK_LOG_LEVEL` – implicit `INFO`

## Limitări (demo)

Depunerile/retragerile sunt simulate; nu există schimb valutar între monede sau 2FA.
Limitarea per IP e în memoria procesului: cu mai multe instanțe, folosește un limitator partajat
(Redis / reverse proxy). Cheile de idempotență nu expiră încă.
