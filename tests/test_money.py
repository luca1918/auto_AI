import pytest

from app.money import to_major, to_minor


def test_to_minor():
    assert to_minor("10") == 1000
    assert to_minor("0.1") == 10
    assert to_minor("19.99") == 1999


@pytest.mark.parametrize("bad", ["0", "-5", "1.234", "abc", "NaN", "Infinity", "1e12"])
def test_to_minor_rejects(bad):
    with pytest.raises(ValueError):
        to_minor(bad)


def test_to_major():
    assert str(to_major(1999)) == "19.99"
