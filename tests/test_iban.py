from app import iban


def test_generated_iban_is_valid():
    for _ in range(50):
        value = iban.generate_ro()
        assert value.startswith("RO") and len(value) == 24
        assert iban.is_valid(value)


def test_known_valid_and_invalid():
    assert iban.is_valid("RO49 AAAA 1B31 0075 9384 0000")
    assert not iban.is_valid("RO48AAAA1B31007593840000")
    assert not iban.is_valid("garbage")
