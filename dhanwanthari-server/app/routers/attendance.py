"""Staff attendance: clock in / out (everyone), register and corrections (admin). Rules in app/attendance.py."""
from __future__ import annotations

from datetime import date, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlmodel import Session, select

from .. import attendance as R
from ..auth import CurrentUser, can, current_user
from ..config import settings
from ..db import get_session, now_utc, time_my, today_my
from ..errors import ApiError, not_found
from ..models import AttendanceEntry, User
from ..posting import audit, settings_row
from ..roles import ROLES

router = APIRouter(prefix="/api/attendance")


def cfg(s: Session) -> dict:
    return {**R.DEFAULT, **(settings_row(s).attendance or {})}


def entry_out(e: AttendanceEntry) -> dict:
    return {"id": e.id, "userId": e.user_id, "date": e.work_date, "kind": e.kind, "in": e.time_in, "out": e.time_out, "leaveType": e.leave_type,
            "note": e.note or "", "source": e.source, "updatedAt": e.updated_at.isoformat() if e.updated_at else None}


def _mine_today(s: Session, uid: str) -> list[AttendanceEntry]:
    return list(s.exec(select(AttendanceEntry).where(AttendanceEntry.user_id == uid, AttendanceEntry.work_date == today_my()).order_by(AttendanceEntry.time_in)))


def _today(s: Session, user: CurrentUser) -> dict:
    es = [entry_out(e) for e in _mine_today(s, user.id)]
    c = cfg(s)
    return {"settings": c, "today": today_my(), "now": time_my(), "entries": es, "status": R.day_status(es, today_my(), today_my(), time_my(), c)}


@router.get("/today")
def today(s: Session = Depends(get_session), user: CurrentUser = Depends(current_user)):
    return _today(s, user)


@router.post("/clock-in")
def clock_in(s: Session = Depends(get_session), user: CurrentUser = Depends(current_user)):
    es = _mine_today(s, user.id)
    if any(e.kind == "work" and e.time_in and not e.time_out for e in es):
        raise ApiError(409, "already_in", "You're already clocked in.")
    e = AttendanceEntry(user_id=user.id, work_date=today_my(), kind="work", time_in=time_my(), source="clock", created_by=user.id)
    s.add(e)
    s.flush()
    return _today(s, user)


@router.post("/clock-out")
def clock_out(s: Session = Depends(get_session), user: CurrentUser = Depends(current_user)):
    open_ = [e for e in _mine_today(s, user.id) if e.kind == "work" and e.time_in and not e.time_out]
    if not open_:
        raise ApiError(409, "not_in", "You're not clocked in.")
    e = open_[-1]
    t = time_my()
    e.time_out = t if R.mins(t) > R.mins(e.time_in) else e.time_in      # same minute → zero-length session
    e.updated_at = now_utc()
    s.add(e)
    return _today(s, user)


@router.get("")
def register(from_: str = Query(alias="from"), to: str = Query(), userId: Optional[str] = None,
             s: Session = Depends(get_session), user: CurrentUser = Depends(current_user)):
    """Admin: everyone (or one person). Others: only themselves."""
    try:
        a, b = date.fromisoformat(from_), date.fromisoformat(to)
    except ValueError:
        raise ApiError(400, "invalid", "Dates should be YYYY-MM-DD") from None
    if b < a or (b - a).days > 366:
        raise ApiError(400, "invalid", "Choose a range of up to one year")
    admin = user.role == "admin"
    if not admin:
        userId = user.id
    q = select(AttendanceEntry).where(AttendanceEntry.work_date >= from_, AttendanceEntry.work_date <= to)
    if userId:
        q = q.where(AttendanceEntry.user_id == userId)
    entries = [entry_out(e) for e in s.exec(q.order_by(AttendanceEntry.work_date, AttendanceEntry.time_in))]
    with_entries = {e["userId"] for e in entries}
    users = [u for u in s.exec(select(User).order_by(User.name)) if (u.id == userId if userId else (u.active or u.id in with_entries))]
    c = cfg(s)
    since = {u.id: _local_day(u.created_at) for u in users}
    return {"settings": c, "today": today_my(), "now": time_my(), "entries": entries,
            "users": [{"id": u.id, "name": u.name, "role": u.role, "roleLabel": ROLES.get(u.role, u.role), "active": u.active, "since": since[u.id]} for u in users],
            "summary": R.summary(entries, [u.id for u in users], from_, to, today_my(), time_my(), c, since)}


def _local_day(dt) -> str | None:
    """the Malaysian date a login was created: no absences are counted before it"""
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (dt + timedelta(hours=settings.tz_offset_hours)).date().isoformat()


class EntryIn(BaseModel):
    userId: str
    date: str
    toDate: Optional[str] = None          # leave over several days
    kind: Literal["work", "leave"]
    timeIn: Optional[str] = None
    timeOut: Optional[str] = None
    leaveType: Optional[str] = None
    note: str = ""


def _check_times(tin: str | None, tout: str | None) -> None:
    if not tin or not R.HHMM.match(tin):
        raise ApiError(400, "invalid", "Enter the clock-in time, like 09:00")
    if tout and not R.HHMM.match(tout):
        raise ApiError(400, "invalid", "Clock-out time should look like 18:00")
    if tout and R.mins(tout) <= R.mins(tin):
        raise ApiError(400, "invalid", "Clock-out must be after clock-in")


@router.post("", status_code=201)
def add_entry(b: EntryIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can())):
    if not s.get(User, b.userId):
        raise not_found("Staff member")
    try:
        d0 = date.fromisoformat(b.date)
        d1 = date.fromisoformat(b.toDate) if b.toDate and b.kind == "leave" else d0
    except ValueError:
        raise ApiError(400, "invalid", "Dates should be YYYY-MM-DD") from None
    if d1 < d0 or (d1 - d0).days > 60:
        raise ApiError(400, "invalid", "Leave can cover up to 60 days at a time")
    if b.kind == "work":
        if d0.isoformat() > today_my():
            raise ApiError(400, "invalid", "Work time can't be entered for a future day")
        _check_times(b.timeIn, b.timeOut)
        e = AttendanceEntry(user_id=b.userId, work_date=b.date, kind="work", time_in=b.timeIn, time_out=b.timeOut or None, note=b.note.strip() or None, source="manual", created_by=user.id)
        s.add(e)
        s.flush()
        audit(s, user.id, "attendance.add", "attendance", e.id, {"user": b.userId, "date": b.date, "in": b.timeIn, "out": b.timeOut})
        return {"created": 1}
    if b.leaveType not in R.LEAVE_TYPES:
        raise ApiError(400, "invalid", f"Leave type must be one of: {', '.join(R.LEAVE_TYPES.values())}")
    created = 0
    for d in R.days_between(d0.isoformat(), d1.isoformat()):
        exists = s.exec(select(AttendanceEntry).where(AttendanceEntry.user_id == b.userId, AttendanceEntry.work_date == d, AttendanceEntry.kind == "leave")).first()
        if exists:
            continue
        s.add(AttendanceEntry(user_id=b.userId, work_date=d, kind="leave", leave_type=b.leaveType, note=b.note.strip() or None, source="manual", created_by=user.id))
        created += 1
    if not created:
        raise ApiError(409, "duplicate", "Leave is already recorded for those days.")
    audit(s, user.id, "attendance.leave", "attendance", b.userId, {"from": d0.isoformat(), "to": d1.isoformat(), "type": b.leaveType, "days": created})
    return {"created": created}


@router.get("/settings")
def get_settings(s: Session = Depends(get_session), _: CurrentUser = Depends(current_user)):
    return cfg(s)


@router.put("/settings")
def put_settings(b: dict, s: Session = Depends(get_session), user: CurrentUser = Depends(can())):
    try:
        c = R.check_settings(b)
    except ValueError as e:
        raise ApiError(400, "invalid", str(e)) from None
    row = settings_row(s)
    row.attendance = c
    s.add(row)
    audit(s, user.id, "attendance.settings", "settings", "attendance", c)
    return c


class EntryEdit(BaseModel):
    timeIn: Optional[str] = None
    timeOut: Optional[str] = None
    leaveType: Optional[str] = None
    note: str = ""
    reason: str = ""


@router.put("/{eid}")
def edit_entry(eid: str, b: EntryEdit, s: Session = Depends(get_session), user: CurrentUser = Depends(can())):
    e = s.get(AttendanceEntry, eid)
    if not e:
        raise not_found("Entry")
    if len(b.reason.strip()) < 3:
        raise ApiError(400, "invalid", "Give a reason for the correction (kept in the audit log)")
    before = entry_out(e)
    if e.kind == "work":
        _check_times(b.timeIn, b.timeOut)
        e.time_in, e.time_out = b.timeIn, b.timeOut or None
    else:
        if b.leaveType not in R.LEAVE_TYPES:
            raise ApiError(400, "invalid", "Choose a leave type")
        e.leave_type = b.leaveType
    e.note, e.updated_by, e.updated_at = b.note.strip() or None, user.id, now_utc()
    s.add(e)
    audit(s, user.id, "attendance.edit", "attendance", eid, {"before": before, "after": entry_out(e), "reason": b.reason.strip()})
    return entry_out(e)


class DeleteIn(BaseModel):
    reason: str = ""


@router.post("/{eid}/delete")
def delete_entry(eid: str, b: DeleteIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can())):
    e = s.get(AttendanceEntry, eid)
    if not e:
        raise not_found("Entry")
    if len(b.reason.strip()) < 3:
        raise ApiError(400, "invalid", "Give a reason for deleting (kept in the audit log)")
    audit(s, user.id, "attendance.delete", "attendance", eid, {"entry": entry_out(e), "reason": b.reason.strip()})
    s.delete(e)
    return {"ok": True}
