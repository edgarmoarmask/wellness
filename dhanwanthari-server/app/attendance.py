"""Staff attendance rules — same as the web app's src/lib/attendance.js.
Times are clinic-local (Malaysia) "HH:MM"; one person can clock in and out more than once a day (split shifts)."""
from __future__ import annotations

import re
from datetime import date, timedelta

DEFAULT = {"start": "09:00", "end": "18:00", "grace": 10, "workdays": [1, 2, 3, 4, 5, 6]}   # ISO weekdays: Mon=1 … Sun=7
LEAVE_TYPES = {"annual": "Annual leave", "medical": "Medical leave", "emergency": "Emergency leave", "unpaid": "Unpaid leave", "public": "Public holiday"}
HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def mins(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def check_settings(raw: dict) -> dict:
    start, end = str(raw.get("start", "")), str(raw.get("end", ""))
    if not HHMM.match(start) or not HHMM.match(end):
        raise ValueError("Shift start and end should be times like 09:00")
    if mins(end) <= mins(start):
        raise ValueError("Shift end must be after shift start")
    try:
        grace = int(raw.get("grace", 0))
    except (TypeError, ValueError):
        raise ValueError("Grace minutes should be a whole number") from None
    if not 0 <= grace <= 120:
        raise ValueError("Grace minutes should be between 0 and 120")
    days = sorted({int(d) for d in raw.get("workdays", [])})
    if not days or any(d < 1 or d > 7 for d in days):
        raise ValueError("Choose at least one working day")
    return {"start": start, "end": end, "grace": grace, "workdays": days}


def day_status(entries: list[dict], day: str, today: str, now: str, cfg: dict, since: str | None = None) -> dict:
    """entries: one person's entries on `day` ({kind, in, out, leaveType}).
    status: leave | late | present | absent | not_in (today, shift not over) | off (not a working day)"""
    leave = next((e for e in entries if e["kind"] == "leave"), None)
    work = sorted((e for e in entries if e["kind"] == "work" and e.get("in")), key=lambda e: e["in"])
    minutes = sum(mins(e["out"]) - mins(e["in"]) for e in work if e.get("out"))
    open_ = [e for e in work if not e.get("out")]
    missing_out = bool(open_) and day < today
    first = work[0]["in"] if work else None
    late = bool(first) and mins(first) > mins(cfg["start"]) + int(cfg["grace"])
    workday = date.fromisoformat(day).isoweekday() in cfg["workdays"]
    if leave:
        status = "leave"
    elif work:
        status = "late" if late else "present"
    elif since and day < since:
        status = "before"              # not on staff yet
    elif not workday:
        status = "off"
    elif day > today or (day == today and mins(now) < mins(cfg["end"])):
        status = "not_in"
    else:
        status = "absent"
    return {"status": status, "first": first, "last": max((e["out"] for e in work if e.get("out")), default=None), "minutes": minutes,
            "clockedIn": bool(open_) and day == today, "missingOut": missing_out, "leaveType": leave["leaveType"] if leave else None,
            "lateBy": max(0, mins(first) - mins(cfg["start"])) if late else 0}


def days_between(a: str, b: str) -> list[str]:
    d0, d1 = date.fromisoformat(a), date.fromisoformat(b)
    return [(d0 + timedelta(days=i)).isoformat() for i in range((d1 - d0).days + 1)]


def summary(entries: list[dict], user_ids: list[str], start: str, end: str, today: str, now: str, cfg: dict, since: dict | None = None) -> dict:
    """Per user over [start, end] (not past today): present, late, absent, leave days by type, minutes, missing clock-outs."""
    out = {}
    days = [d for d in days_between(start, end) if d <= today]
    for uid in user_ids:
        mine = [e for e in entries if e["userId"] == uid]
        r = {"present": 0, "late": 0, "absent": 0, "leave": {}, "minutes": 0, "missingOut": 0}
        for d in days:
            st = day_status([e for e in mine if e["date"] == d], d, today, now, cfg, (since or {}).get(uid))
            if st["status"] in ("present", "late"):
                r["present"] += 1
            if st["status"] == "late":
                r["late"] += 1
            if st["status"] == "absent":
                r["absent"] += 1
            if st["status"] == "leave":
                r["leave"][st["leaveType"]] = r["leave"].get(st["leaveType"], 0) + 1
            r["minutes"] += st["minutes"]
            r["missingOut"] += 1 if st["missingOut"] else 0
        out[uid] = r
    return out
