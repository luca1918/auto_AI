"""Virtual card number generation and at-rest encryption of the card number and CVV."""

import base64
import hashlib
import json
import secrets
from datetime import datetime, timezone

from cryptography.fernet import Fernet, InvalidToken

from app import config

# Issuer prefix for AutoBank virtual cards (demo range, not a real network BIN).
CARD_PREFIX = "400012"
CARD_VALIDITY_YEARS = 4


def _fernet() -> Fernet:
    if config.CARD_ENCRYPTION_KEY:
        return Fernet(config.CARD_ENCRYPTION_KEY)
    digest = hashlib.sha256(b"autobank-card-key:" + config.SECRET_KEY.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def luhn_check_digit(partial: str) -> str:
    total = 0
    for i, ch in enumerate(reversed(partial)):
        d = int(ch)
        if i % 2 == 0:  # these positions are doubled once the check digit is appended
            d = d * 2 - 9 if d > 4 else d * 2
        total += d
    return str((10 - total % 10) % 10)


def luhn_valid(number: str) -> bool:
    return number.isdigit() and luhn_check_digit(number[:-1]) == number[-1]


def generate() -> dict:
    body = CARD_PREFIX + "".join(secrets.choice("0123456789") for _ in range(9))
    pan = body + luhn_check_digit(body)
    now = datetime.now(timezone.utc)
    return {
        "pan": pan,
        "cvv": f"{secrets.randbelow(1000):03d}",
        "expiry_month": now.month,
        "expiry_year": now.year + CARD_VALIDITY_YEARS,
    }


def encrypt(pan: str, cvv: str) -> str:
    return _fernet().encrypt(json.dumps({"pan": pan, "cvv": cvv}).encode()).decode()


def decrypt(token: str) -> dict:
    """Raises InvalidToken if the encryption key changed since the card was issued."""
    return json.loads(_fernet().decrypt(token.encode()))


__all__ = ["InvalidToken", "decrypt", "encrypt", "generate", "luhn_valid"]
