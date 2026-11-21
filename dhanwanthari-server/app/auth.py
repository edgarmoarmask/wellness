"""Sign-in: email + password → 6-digit code (email) → JWT for an 8-hour shift. Role checks per endpoint."""
from __future__ import annotations

import hashlib
import logging
import secrets
import time
from datetime import timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, Header
from sqlmodel import Session, select

from .config import settings
from .db import get_session, now_utc
from .errors import ApiError
from .models import LoginChallenge, User

log = logging.getLogger("dvc.auth")
_ph = PasswordHasher()
ROLES = {"admin", "vaidya", "therapist", "front", "pharmacist", "finance"}


def hash_password(pw: str) -> str:
    return _ph.hash(pw)


def _verify_pw(h: str, pw: str) -> bool:
    try:
        return _ph.verify(h, pw)
    except VerifyMismatchError:
        return False
    except Exception:  # malformed hash
        return False


def _hash_code(code: str) -> str:
    return hashlib.sha256((settings.otp_pepper + code).encode()).hexdigest()


def _make_code() -> str:
    return settings.demo_fixed_otp or f"{secrets.randbelow(1_000_000):06d}"


def _deliver(s: Session, u: User, code: str) -> None:
    """Email the code (Amazon SES when EMAIL_PROVIDER=ses). In development it is always printed on the server console too.
    Production without email set up: only OTP_DELIVERY=log prints it (interim)."""
    from .emails import send_otp
    if settings.production and settings.email_provider != "ses":
        if settings.otp_delivery == "log":
            log.warning("[otp] %s → %s", u.email, code)
        else:
            log.error("[otp] no email set up: set EMAIL_PROVIDER=ses (see README) or OTP_DELIVERY=log")
        return
    res = send_otp(s, u.email, u.name, code)
    if res["status"] in ("failed", "not_configured") and settings.production:
        raise ApiError(503, "email_failed", "Couldn't send the sign-in code by email. Try again, or ask the admin to check the email settings.")


def login(s: Session, email: str, password: str) -> dict:
    u = s.exec(select(User).where(User.email == email.strip().lower())).first()
    if not u or not u.active or not _verify_pw(u.password_hash, password):
        time.sleep(0.25)
        raise ApiError(401, "bad_credentials", "Email or password is not right.")
    code = _make_code()
    ch = LoginChallenge(user_id=u.id, code_hash=_hash_code(code), expires_at=now_utc() + timedelta(minutes=5))
    s.add(ch)
    s.flush()
    _deliver(s, u, code)
    out = {"challengeId": ch.id}
    if settings.otp_delivery == "response":   # tests / local only — never in production
        out["devCode"] = code
    return out


def verify(s: Session, challenge_id: str, code: str) -> dict:
    ch = s.get(LoginChallenge, challenge_id)
    if not ch or ch.used:
        raise ApiError(401, "code_expired", "Code expired. Sign in again.")
    ch.tries += 1
    exp = ch.expires_at if ch.expires_at.tzinfo else ch.expires_at.replace(tzinfo=now_utc().tzinfo)
    if exp < now_utc() or ch.tries > 5:
        s.add(ch)
        s.commit()
        raise ApiError(401, "code_expired", "Code expired. Sign in again.")
    if not secrets.compare_digest(ch.code_hash, _hash_code(code)):
        s.add(ch)
        s.commit()   # keep the try count even though the request fails
        raise ApiError(401, "bad_code", "Wrong code.")
    ch.used = True
    s.add(ch)
    u = s.get(User, ch.user_id)
    u.last_login_at = now_utc()
    s.add(u)
    exp_ts = int(time.time()) + settings.session_hours * 3600
    token = jwt.encode({"sub": u.id, "role": u.role, "name": u.name, "email": u.email, "tv": u.token_version, "exp": exp_ts}, settings.secret(), algorithm="HS256")
    return {"token": token, "user": {"id": u.id, "name": u.name, "role": u.role, "email": u.email}}


class CurrentUser(dict):
    @property
    def id(self) -> str:
        return self["sub"]

    @property
    def role(self) -> str:
        return self["role"]


def current_user(authorization: str | None = Header(default=None), s: Session = Depends(get_session)) -> CurrentUser:
    """Checks the token AND the user record on every request, so deactivating a user, changing their role
    or resetting their password takes effect at once (not when the token expires)."""
    if not authorization or not authorization.startswith("Bearer "):
        raise ApiError(401, "no_token", "Sign in first.")
    try:
        claims = jwt.decode(authorization[7:], settings.secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        raise ApiError(401, "bad_token", "Session expired. Sign in again.") from None
    u = s.get(User, claims.get("sub"))
    if not u or not u.active or u.token_version != claims.get("tv", 0):
        raise ApiError(401, "signed_out", "Your sign-in is no longer valid. Sign in again.")
    return CurrentUser({**claims, "role": u.role, "name": u.name, "email": u.email})


def can(*roles: str):
    """Dependency: allow these roles (admin is always allowed)."""
    def dep(user: CurrentUser = Depends(current_user)) -> CurrentUser:
        if user.role != "admin" and user.role not in roles:
            raise ApiError(403, "forbidden", "Your role cannot do this.")
        return user
    return dep


SessionDep = Depends(get_session)
