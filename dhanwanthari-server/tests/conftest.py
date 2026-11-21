"""Each test run gets a fresh SQLite file, migrated with Alembic and seeded (clinic setup only, no patients)."""
import os
import tempfile
from pathlib import Path

import pytest

_db = Path(tempfile.mkdtemp()) / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_db}"
os.environ["OTP_DELIVERY"] = "response"
os.environ["EMAIL_PROVIDER"] = "memory"
os.environ.setdefault("APP_ENV", "test")

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session")
def client():
    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    command.upgrade(cfg, "head")
    from app.seed import run
    run("admin@dhanwanthari.test", "Dhanwanthari@2026")
    from app.main import app
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def api(client):
    r = client.post("/api/auth/login", json={"email": "admin@dhanwanthari.test", "password": "Dhanwanthari@2026"})
    assert r.status_code == 200
    v = client.post("/api/auth/verify", json={"challengeId": r.json()["challengeId"], "code": r.json()["devCode"]})
    assert v.status_code == 200
    token = v.json()["token"]

    class Api:
        c = client
        headers = {"authorization": "Bearer " + token}

        def __call__(self, method, path, body=None, auth=True):
            r = client.request(method, path, json=body, headers=self.headers if auth else {})
            try:
                return r.status_code, r.json()
            except Exception:
                return r.status_code, r.content
    return Api()
