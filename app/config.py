import os
import secrets

ENVIRONMENT = os.getenv("BANK_ENV", "development")
DATABASE_URL = os.getenv("BANK_DATABASE_URL", "sqlite:///./bank.db")

SECRET_KEY = os.getenv("BANK_SECRET_KEY", "")
if not SECRET_KEY:
    if ENVIRONMENT == "production":
        raise RuntimeError("BANK_SECRET_KEY must be set in production")
    # Dev fallback: tokens are invalidated on every restart.
    SECRET_KEY = secrets.token_urlsafe(32)

TOKEN_TTL_MINUTES = int(os.getenv("BANK_TOKEN_TTL_MINUTES", "30"))
LOG_LEVEL = os.getenv("BANK_LOG_LEVEL", "INFO")

# Brute-force protection
LOGIN_MAX_FAILURES = int(os.getenv("BANK_LOGIN_MAX_FAILURES", "5"))
LOGIN_LOCK_MINUTES = int(os.getenv("BANK_LOGIN_LOCK_MINUTES", "15"))
AUTH_RATE_LIMIT_PER_MINUTE = int(os.getenv("BANK_AUTH_RATE_LIMIT_PER_MINUTE", "20"))

BANK_CODE = "AUTO"
SUPPORTED_CURRENCIES = ("RON", "EUR", "USD")
