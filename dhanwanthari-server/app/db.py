"""SQLite engine and per-request session. One transaction per request: commit on success, roll back on error."""
from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import event, text
from sqlmodel import Session, create_engine

from .config import settings


def _make_engine(url: str):
    if url.startswith("sqlite:///"):
        Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    eng = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30} if url.startswith("sqlite") else {})
    if url.startswith("sqlite"):
        @event.listens_for(eng, "connect")
        def _pragmas(dbapi_conn, _):  # noqa: ANN001
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")      # readers don't block the writer
            cur.execute("PRAGMA synchronous=NORMAL")
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA busy_timeout=30000")
            cur.close()
    return eng


engine = _make_engine(settings.database_url)


def get_session() -> Iterator[Session]:
    with Session(engine) as s:
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def today_my() -> str:
    """Today's date in Malaysia (UTC+8), YYYY-MM-DD."""
    return (datetime.now(timezone.utc) + timedelta(hours=settings.tz_offset_hours)).date().isoformat()


def time_my() -> str:
    return (datetime.now(timezone.utc) + timedelta(hours=settings.tz_offset_hours)).strftime("%H:%M")


def next_number(s: Session, name: str) -> int:
    """Gap-free running number (invoices, receipts, patients). Atomic inside the request's transaction."""
    row = s.exec(text("INSERT INTO counters (name, value) VALUES (:n, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value").bindparams(n=name)).first()  # type: ignore[call-overload]
    return int(row[0])
