from pathlib import Path
import sys

import pytest

sys.path.append(str(Path(__file__).resolve().parents[1]))

from auth_utils import get_jwt_secret_key


@pytest.mark.parametrize(
    ("jwt_secret", "fallback_secret", "expected"),
    [
        ("jwt-secret", None, "jwt-secret"),
        (None, "legacy-secret", "legacy-secret"),
        ("jwt-secret", "legacy-secret", "jwt-secret"),
    ],
)
def test_get_jwt_secret_key_uses_expected_env(monkeypatch, jwt_secret, fallback_secret, expected):
    if jwt_secret is None:
        monkeypatch.delenv("JWT_SECRET_KEY", raising=False)
    else:
        monkeypatch.setenv("JWT_SECRET_KEY", jwt_secret)

    if fallback_secret is None:
        monkeypatch.delenv("SECRET_KEY", raising=False)
    else:
        monkeypatch.setenv("SECRET_KEY", fallback_secret)

    assert get_jwt_secret_key() == expected


def test_get_jwt_secret_key_raises_when_missing(monkeypatch):
    monkeypatch.delenv("JWT_SECRET_KEY", raising=False)
    monkeypatch.delenv("SECRET_KEY", raising=False)

    with pytest.raises(RuntimeError, match="JWT_SECRET_KEY is required"):
        get_jwt_secret_key()
