import os
import secrets
from pathlib import Path

ENVIRONMENT = os.getenv("BANK_ENV", "development")
DATABASE_URL = os.getenv("BANK_DATABASE_URL", "sqlite:///./bank.db")


def _dev_secret() -> str:
    """Dev-only secret persisted next to the project so sessions and card data survive restarts."""
    path = Path(os.getenv("BANK_DEV_SECRET_FILE", ".dev-secret"))
    try:
        return path.read_text().strip()
    except FileNotFoundError:
        value = secrets.token_urlsafe(32)
        path.write_text(value)
        return value


SECRET_KEY = os.getenv("BANK_SECRET_KEY", "")
if not SECRET_KEY:
    if ENVIRONMENT == "production":
        raise RuntimeError("BANK_SECRET_KEY must be set in production")
    SECRET_KEY = _dev_secret()

# Encrypts stored card numbers. Defaults to a key derived from SECRET_KEY; set it separately
# in production so rotating the JWT secret doesn't make existing cards unreadable.
CARD_ENCRYPTION_KEY = os.getenv("BANK_CARD_ENCRYPTION_KEY", "")

TOKEN_TTL_MINUTES = int(os.getenv("BANK_TOKEN_TTL_MINUTES", "30"))
LOG_LEVEL = os.getenv("BANK_LOG_LEVEL", "INFO")
# Month boundaries for statistics and card limits are computed in the bank's local time.
TIMEZONE = os.getenv("BANK_TIMEZONE", "Europe/Bucharest")

# Brute-force protection
LOGIN_MAX_FAILURES = int(os.getenv("BANK_LOGIN_MAX_FAILURES", "5"))
LOGIN_LOCK_MINUTES = int(os.getenv("BANK_LOGIN_LOCK_MINUTES", "15"))
AUTH_RATE_LIMIT_PER_MINUTE = int(os.getenv("BANK_AUTH_RATE_LIMIT_PER_MINUTE", "20"))

BANK_CODE = "AUTO"
SUPPORTED_CURRENCIES = ("RON", "EUR", "USD")

# Spending categories; "internal" and "savings" are moves between the customer's own money
# and are left out of income/expense statistics.
CATEGORIES = ("groceries", "restaurants", "transport", "shopping", "entertainment", "bills", "health",
              "travel", "transfers", "income", "cash", "savings", "internal", "other")
CARD_PAYMENT_CATEGORIES = ("groceries", "restaurants", "transport", "shopping", "entertainment", "bills",
                           "health", "travel", "other")
NON_SPENDING_CATEGORIES = ("savings", "internal")
