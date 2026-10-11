import os
import secrets

DATABASE_URL = os.getenv("BANK_DATABASE_URL", "sqlite:///./bank.db")
# In production set BANK_SECRET_KEY; the random fallback invalidates tokens on restart.
SECRET_KEY = os.getenv("BANK_SECRET_KEY") or secrets.token_urlsafe(32)
TOKEN_TTL_MINUTES = int(os.getenv("BANK_TOKEN_TTL_MINUTES", "30"))
BANK_CODE = "AUTO"
SUPPORTED_CURRENCIES = ("RON", "EUR", "USD")
