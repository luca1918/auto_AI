import re
import secrets
import string

from app.config import BANK_CODE

_ALNUM = string.digits + string.ascii_uppercase


def _to_digits(s: str) -> str:
    return "".join(str(int(c, 36)) for c in s)


def is_valid(iban: str) -> bool:
    iban = normalize(iban)
    if not re.fullmatch(r"[A-Z]{2}\d{2}[A-Z0-9]{11,30}", iban):
        return False
    return int(_to_digits(iban[4:] + iban[:4])) % 97 == 1


def normalize(iban: str) -> str:
    return iban.replace(" ", "").upper()


def generate_ro() -> str:
    """Romanian IBAN: RO + 2 check digits + 4-char bank code + 16 alphanumerics."""
    bban = BANK_CODE + "".join(secrets.choice(_ALNUM) for _ in range(16))
    check = 98 - int(_to_digits(bban + "RO00")) % 97
    return f"RO{check:02d}{bban}"
