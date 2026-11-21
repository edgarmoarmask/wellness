"""Staff users (Administration). Admin only, except changing your own password.
Safety rules: you can't remove your own admin rights or deactivate yourself, and the last active admin stays."""
from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import CurrentUser, _verify_pw, can, current_user, hash_password
from ..db import get_session
from ..errors import ApiError, not_found
from ..models import User
from ..posting import audit
from ..roles import ROLES

router = APIRouter(prefix="/api")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def check_password(pw: str) -> None:
    if len(pw or "") < 10 or not re.search(r"[A-Za-z]", pw) or not re.search(r"\d", pw):
        raise ApiError(400, "weak_password", "Password needs at least 10 characters, with letters and numbers.")


def user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role, "roleLabel": ROLES.get(u.role, u.role), "active": u.active,
            "createdAt": u.created_at.isoformat() if u.created_at else None, "lastLoginAt": u.last_login_at.isoformat() if u.last_login_at else None}


def _admins_left(s: Session, without: str) -> int:
    return len([u for u in s.exec(select(User).where(User.role == "admin", User.active == True)) if u.id != without])  # noqa: E712


@router.get("/roles")
def roles(_: CurrentUser = Depends(current_user)):
    return [{"id": k, "label": v} for k, v in ROLES.items()]


@router.get("/users")
def list_users(s: Session = Depends(get_session), _: CurrentUser = Depends(can())):
    return [user_out(u) for u in s.exec(select(User).order_by(User.active.desc(), User.name))]  # type: ignore[attr-defined]


class UserIn(BaseModel):
    name: str = ""
    email: str = ""
    role: str = ""
    password: str = ""


def _clean(name: str, email: str, role: str) -> tuple[str, str, str]:
    name, email, role = re.sub(r"\s+", " ", (name or "").strip()), (email or "").strip().lower(), (role or "").strip().lower()
    if len(name) < 2:
        raise ApiError(400, "invalid", "Enter the person's name", issues=[{"path": "name", "message": "Enter the person's name"}])
    if not EMAIL.match(email):
        raise ApiError(400, "invalid", "Enter a valid email address", issues=[{"path": "email", "message": "Enter a valid email address"}])
    if role not in ROLES:
        raise ApiError(400, "invalid", f"Role must be one of: {', '.join(ROLES.values())}", issues=[{"path": "role", "message": "Choose a role"}])
    return name, email, role


@router.post("/users", status_code=201)
def create_user(b: UserIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can())):
    name, email, role = _clean(b.name, b.email, b.role)
    check_password(b.password)
    if s.exec(select(User).where(User.email == email)).first():
        raise ApiError(409, "duplicate", f"{email} already has a login.")
    u = User(email=email, name=name, role=role, password_hash=hash_password(b.password))
    s.add(u)
    s.flush()
    audit(s, user.id, "user.create", "user", u.id, {"email": email, "role": role})
    return user_out(u)


class UserEdit(BaseModel):
    name: str = ""
    email: str = ""
    role: str = ""
    active: bool = True


@router.put("/users/{uid}")
def update_user(uid: str, b: UserEdit, s: Session = Depends(get_session), user: CurrentUser = Depends(can())):
    u = s.get(User, uid)
    if not u:
        raise not_found("User")
    name, email, role = _clean(b.name, b.email, b.role)
    if uid == user.id and (role != "admin" or not b.active):
        raise ApiError(409, "self", "You can't remove your own admin rights or deactivate yourself. Ask another admin.")
    if u.role == "admin" and u.active and (role != "admin" or not b.active) and _admins_left(s, uid) == 0:
        raise ApiError(409, "last_admin", "This is the only active admin. Make someone else admin first.")
    other = s.exec(select(User).where(User.email == email, User.id != uid)).first()
    if other:
        raise ApiError(409, "duplicate", f"{email} already has a login.")
    before = {"name": u.name, "email": u.email, "role": u.role, "active": u.active}
    if (u.active and not b.active) or u.role != role or u.email != email:
        u.token_version += 1          # signs them out on every device
    u.name, u.email, u.role, u.active = name, email, role, b.active
    s.add(u)
    audit(s, user.id, "user.update", "user", uid, {"before": before, "after": {"name": name, "email": email, "role": role, "active": b.active}})
    return user_out(u)


class PasswordIn(BaseModel):
    password: str = ""
    current: Optional[str] = None


@router.post("/users/{uid}/password")
def reset_password(uid: str, b: PasswordIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can())):
    """Admin sets a new password (e.g. forgotten). The user is signed out everywhere."""
    u = s.get(User, uid)
    if not u:
        raise not_found("User")
    check_password(b.password)
    u.password_hash, u.token_version = hash_password(b.password), u.token_version + 1
    s.add(u)
    audit(s, user.id, "user.password_reset", "user", uid, {"email": u.email})
    return {"ok": True}


@router.post("/me/password")
def change_my_password(b: PasswordIn, s: Session = Depends(get_session), user: CurrentUser = Depends(current_user)):
    """Any signed-in user. Other devices are signed out; this one needs to sign in again too."""
    u = s.get(User, user.id)
    if not b.current or not _verify_pw(u.password_hash, b.current):
        raise ApiError(400, "bad_current", "Current password is wrong.")
    check_password(b.password)
    if _verify_pw(u.password_hash, b.password):
        raise ApiError(400, "same_password", "Choose a password different from the current one.")
    u.password_hash, u.token_version = hash_password(b.password), u.token_version + 1
    s.add(u)
    audit(s, user.id, "user.password_change", "user", u.id, {})
    return {"ok": True}
