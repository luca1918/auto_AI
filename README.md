# AutoBank

Aplicație bancară demo, mobile-first: backend FastAPI + PostgreSQL (sau SQLite local) și o aplicație web
instalabilă pe telefon (PWA), în română, cu temă întunecată și accent galben.

<p>
  <img src="docs/screenshots/home.png" width="200" alt="Ecranul principal">
  <img src="docs/screenshots/cards.png" width="200" alt="Carduri virtuale">
  <img src="docs/screenshots/savings.png" width="200" alt="Pușculițe">
  <img src="docs/screenshots/stats.png" width="200" alt="Statistici">
</p>

## Pornire rapidă

```bash
pip install -r requirements-dev.txt
alembic upgrade head          # SQLite implicit: ./bank.db
python -m app.seed            # opțional: client demo cu 6 luni de istoric
uvicorn app.main:app --reload
```

Deschide http://localhost:8000 (pe telefon: adresa calculatorului din rețea) și intră cu
**demo@autobank.ro / demo1234**, sau creează un cont nou. Documentația API e la http://localhost:8000/docs.

Pe telefon, aplicația se poate instala pe ecranul principal: în Safari *Partajează → Adaugă pe ecranul principal*,
în Chrome *⋮ → Instalează aplicația*. Service worker-ul are nevoie de HTTPS (sau `localhost`).

## Ce poate face

**Acasă** – salut, scurtături, carusel cu conturile (sold, *Plătește*, *Adaugă bani*, *Mai multe*), pușculițe,
cheltuielile lunii și tranzacțiile recente.

**Plăți** – transfer către orice IBAN AutoBank (cu pas de confirmare), mutare între conturile proprii,
beneficiari salvați, istoricul transferurilor.

**Carduri virtuale** – emitere instant, număr/CVV afișate la cerere (ascunse automat după 30 s, fiecare afișare e
auditată), înghețare/dezghețare, limită lunară cu indicator, plată de test la un comerciant, închidere.

**Economii (pușculițe)** – obiective cu sumă țintă, pictogramă și termen; depuneri și retrageri din contul asociat;
**rotunjire automată**: fiecare plată cu cardul se rotunjește la leu întreg, iar diferența intră în pușculiță.
Închiderea unei pușculițe întoarce banii în cont.

**Statistici** – cheltuieli și venituri pe lună (cu variația față de luna trecută), grafic pe 6 luni și
defalcare pe categorii; mutările între conturile proprii și pușculițe nu sunt numărate drept cheltuieli.

**Căutare** – după comerciant, persoană, IBAN, sumă (ex. `23,45`) sau categorie, în toate conturile.

**Profil** – conturi, extras de cont CSV (Excel), schimbarea parolei, instalare, ieșire.

## Arhitectură

```
app/
  main.py            aplicația FastAPI, antete de securitate, servește PWA-ul
  banking.py         toată mișcarea banilor (conturi, transferuri, pușculițe, plăți cu cardul, rotunjiri)
  stats.py           agregări pe luni/categorii, în fusul orar al băncii
  cards.py           generare card (Luhn) și criptarea numărului/CVV-ului (Fernet)
  idempotency.py     chei Idempotency-Key pentru operațiunile cu bani
  routers/           endpoint-uri: auth, accounts, goals, cards, beneficiaries, stats, health
  seed.py            date demo
  static/            PWA: index.html, css/, js/ (module ES, fără build), sw.js, manifest, iconițe
migrations/          migrații Alembic
tests/               teste API (rulează pe SQLite sau PostgreSQL)
```

Interfața e scrisă în JavaScript simplu (module ES), fără pas de build. Tot conținutul dinamic trece printr-un
template care face escaping automat, iar CSP-ul (`script-src 'self'`) blochează scripturile inline.

### Siguranța banilor

- Sumele sunt întregi în subunități (bani/cenți), `BIGINT` în baza de date.
- Debitările sunt `UPDATE ... WHERE balance >= suma`, deci niciun sold (cont sau pușculiță) nu poate deveni negativ.
- Rândurile se blochează mereu în aceeași ordine (conturi după id, apoi pușculițe, apoi carduri), deci
  operațiunile simultane nu intră în deadlock. Limita lunară a cardului se verifică sub blocarea cardului.
- Pe SQLite, tranzacțiile pornesc cu `BEGIN IMMEDIATE` pentru același efect.
- `Idempotency-Key` pe depuneri, retrageri, transferuri, pușculițe și plăți cu cardul: o reîncercare returnează
  răspunsul inițial (`Idempotent-Replayed: true`) fără a muta banii din nou. Interfața trimite o cheie la fiecare acțiune.

### Securitate și operare

- Parole bcrypt, token JWT; contul se blochează 15 minute după 5 parole greșite, rutele de autentificare sunt
  limitate per IP (în memoria procesului).
- Numărul cardului și CVV-ul sunt criptate în baza de date; în listări apar doar ultimele 4 cifre.
- Audit log pentru autentificări, conturi, carduri (inclusiv afișarea detaliilor) și orice mișcare de bani.
- Antete CSP, `X-Frame-Options`, `nosniff`, `no-referrer`; răspunsurile API au `Cache-Control: no-store`,
  iar service worker-ul nu memorează niciodată date din API.
- Loguri JSON cu `X-Request-ID`, `/health/live` și `/health/ready`.
- Cu `BANK_ENV=production`, aplicația refuză să pornească fără `BANK_SECRET_KEY`.

## Docker (PostgreSQL)

```bash
echo "BANK_SECRET_KEY=$(openssl rand -hex 32)" > .env
echo "BANK_CARD_ENCRYPTION_KEY=$(python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')" >> .env
docker compose up --build
```

Containerul aplică migrațiile la pornire. Scriptul de date demo refuză să ruleze cu `BANK_ENV=production`,
pentru că utilizatorii demo au o parolă publică.

## Teste

```bash
pytest                                                                             # SQLite
BANK_TEST_DATABASE_URL=postgresql+psycopg://bank:bank@localhost/bank_test pytest   # PostgreSQL
```

Atenție: suita șterge și recreează tabelele din baza de test.

## API (rezumat)

| Rută | Descriere |
|---|---|
| `POST /api/auth/register`, `/login`, `/change-password`, `GET /api/auth/me` | autentificare |
| `GET/POST /api/accounts`, `GET/PATCH /api/accounts/{id}` | conturi |
| `GET /api/accounts/{id}/transactions`, `GET /api/transactions?q=&category=` | istoric și căutare |
| `POST /api/accounts/{id}/deposit`, `/withdraw`, `POST /api/transfers` | mișcări de bani |
| `GET /api/accounts/{id}/statement.csv?from=&to=` | extras de cont |
| `GET/POST /api/goals`, `GET/PATCH/DELETE /api/goals/{id}`, `/entries`, `/deposit`, `/withdraw` | pușculițe |
| `GET/POST /api/cards`, `GET/PATCH/DELETE /api/cards/{id}`, `/details`, `/transactions`, `/payments` | carduri |
| `GET/POST /api/beneficiaries`, `PATCH/DELETE /api/beneficiaries/{id}` | beneficiari |
| `GET /api/stats?account_id=&month=YYYY-MM&months=6` | statistici |

## Variabile de mediu

| Variabilă | Implicit | Rol |
|---|---|---|
| `BANK_DATABASE_URL` | `sqlite:///./bank.db` | baza de date |
| `BANK_ENV` | `development` | `production` cere `BANK_SECRET_KEY` |
| `BANK_SECRET_KEY` | (în dev: generată în `.dev-secret`) | semnarea tokenurilor JWT |
| `BANK_CARD_ENCRYPTION_KEY` | derivată din `BANK_SECRET_KEY` | cheie Fernet pentru datele cardurilor |
| `BANK_TIMEZONE` | `Europe/Bucharest` | granițele lunilor pentru statistici și limite |
| `BANK_TOKEN_TTL_MINUTES` | `30` | durata sesiunii |
| `BANK_LOGIN_MAX_FAILURES` / `BANK_LOGIN_LOCK_MINUTES` | `5` / `15` | blocarea contului |
| `BANK_AUTH_RATE_LIMIT_PER_MINUTE` | `20` | limită per IP pe autentificare |
| `BANK_LOG_LEVEL` | `INFO` | nivel log |

## Limitări (demo)

Banii, cardurile și plățile sunt simulate. Nu există schimb valutar între monede, 2FA sau transferuri către alte
bănci. Limitarea per IP e în memoria procesului (cu mai multe instanțe, folosește Redis sau reverse proxy-ul),
iar cheile de idempotență nu expiră încă.
