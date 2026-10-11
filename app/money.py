from decimal import Decimal, InvalidOperation

MAX_AMOUNT_MINOR = 100_000_000_00  # 100 milioane per operațiune


def to_minor(amount: Decimal | str | int | float) -> int:
    try:
        value = Decimal(str(amount))
    except InvalidOperation as exc:
        raise ValueError("Sumă invalidă") from exc
    if not value.is_finite():
        raise ValueError("Sumă invalidă")
    if value.as_tuple().exponent < -2:
        raise ValueError("Suma poate avea cel mult 2 zecimale")
    minor = int(value * 100)
    if minor <= 0:
        raise ValueError("Suma trebuie să fie pozitivă")
    if minor > MAX_AMOUNT_MINOR:
        raise ValueError("Suma depășește limita per operațiune")
    return minor


def to_major(minor: int) -> Decimal:
    return (Decimal(minor) / 100).quantize(Decimal("0.01"))
