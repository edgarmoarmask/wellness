"""Therapy menu and packages: checks with the same rules and messages as the web app (src/lib/catalog.js).
A package is a collection of therapies, each with a number of sessions, sold at one package price."""
import re

from . import ledger as L
from .errors import ApiError

GROUPS = {"wellness": "Wellness offer", "walkin": "Walk-in treatment"}
GROUP_KEY = {"wellness offer": "wellness", "wellness package": "wellness", "wellness": "wellness", "walk-in treatment": "walkin", "walk-in": "walkin",
             "walkin": "walkin", "add-on": "walkin", "addon": "walkin"}   # old CSVs: add-on → walk-in
LABELS = ["", "promo", "member", "special"]


def _bad(msg):
    raise ApiError(400, "invalid", msg, issues=[{"path": "item", "message": msg}])


def _clean(v) -> str:
    if isinstance(v, dict):
        v = v.get("en")
    return re.sub(r"\s+", " ", str(v if v is not None else "").strip())


def _num(v):
    if v is None or v == "":
        return None
    try:
        return float(re.sub(r"[, ]|RM", "", str(v), flags=re.I))
    except ValueError:
        return None


def _blank(v) -> bool:
    return v is None or v == ""


def find_therapy(therapies: list[dict], key) -> dict | None:
    """by id or code, case-insensitive; deleted excluded. therapies: [{id, code, name(en), active}]"""
    k = _clean(key).lower()
    if not k:
        return None
    return next((t for t in therapies if t["active"] and (t["id"].lower() == k or (t["code"] or "").lower() == k)), None)


def check_therapy(raw: dict, *, item_id: str | None, others: list[dict]) -> dict:
    """others: active therapies as {id, code, name}. Returns clean fields in the app's shape."""
    name = _clean(raw.get("name"))
    if len(name) < 2:
        _bad("Enter the therapy name")
    if len(name) > 160:
        _bad("Therapy name is too long (max 160 characters)")
    if any(o["id"] != item_id and o["name"].lower() == name.lower() for o in others):
        _bad(f'A therapy called "{name}" already exists')
    code = _clean(raw.get("code")).upper()
    if len(code) > 12:
        _bad("Code is too long (max 12 characters)")
    if code and any(o["id"] != item_id and (o["code"] or "").upper() == code for o in others):
        _bad(f"Code {code} is already used")
    group = GROUP_KEY.get(_clean(raw.get("group")).lower())
    if not group:
        _bad("Group must be wellness or walk-in")
    mins = None if _blank(raw.get("mins")) else _num(raw.get("mins"))
    if not _blank(raw.get("mins")) and not (mins is not None and mins == int(mins) and 5 <= mins <= 600):
        _bad("Duration must be whole minutes between 5 and 600 (or blank)")
    price = _num(raw.get("price"))
    if price is None or price < 0:
        _bad("Enter the price (RM)")
    normal = None if _blank(raw.get("normal")) else _num(raw.get("normal"))
    if not _blank(raw.get("normal")) and not (normal is not None and normal > price):
        _bad("Normal price must be higher than the price charged (or blank)")
    label = _clean(raw.get("label")).lower()
    if label not in LABELS:
        _bad("Offer label must be promo, member, special or blank")
    benefits = _clean(raw.get("benefits"))
    if len(benefits) > 600:
        _bad("Benefits text is too long (max 600 characters)")
    return {"code": code or None, "name": {"en": name, "ms": name}, "group": GROUPS[group], "wellness": group == "wellness", "mins": int(mins) if mins is not None else None,
            "price": L.r2(price), "normal": L.r2(normal) if normal is not None else None, "label": label or None,
            "benefits": {"en": benefits, "ms": benefits} if benefits else None, "advance": bool(raw.get("advance"))}


def check_package(raw: dict, *, item_id: str | None, others: list[dict], therapies: list[dict]) -> dict:
    """others: active packages {id, name}; therapies: [{id, code, name, active}]"""
    name = _clean(raw.get("name"))
    if len(name) < 2:
        _bad("Enter the package name")
    if len(name) > 160:
        _bad("Package name is too long (max 160 characters)")
    if any(o["id"] != item_id and o["name"].lower() == name.lower() for o in others):
        _bad(f'A package called "{name}" already exists')
    items = []
    for it in raw.get("items") or []:
        t = find_therapy(therapies, it.get("svc"))
        if not t:
            _bad(f'Therapy "{it.get("svc")}" not found. Use a therapy code or id from the therapy list.')
        n = _num(it.get("n"))
        if not (n is not None and n == int(n) and 1 <= n <= 100):
            _bad(f"Sessions for {t['name']} must be a whole number from 1 to 100")
        if any(x["svc"] == t["id"] for x in items):
            _bad(f"{t['name']} is listed twice. Put all its sessions on one line.")
        items.append({"svc": t["id"], "n": int(n)})
    if items:
        sessions = sum(x["n"] for x in items)
    else:          # flexible package: total sessions, any therapy recorded
        if _blank(raw.get("sessions")):
            _bad("Add at least one therapy, or enter the total sessions for a flexible package")
        n = _num(raw.get("sessions"))
        if not (n is not None and n == int(n) and n >= 1):
            _bad("Total sessions must be a whole number, 1 or more")
        sessions = int(n)
    if sessions > 200:
        _bad("A package can have up to 200 sessions")
    price = _num(raw.get("price"))
    if price is None or price <= 0:
        _bad("Enter the package price (RM)")
    code = _clean(raw.get("code")).upper()
    if len(code) > 20:
        _bad("Plan code is too long (max 20 characters)")
    if code and any(o["id"] != item_id and (o.get("code") or "").upper() == code for o in others):
        _bad(f"Plan code {code} is already used")
    duration = _clean(raw.get("duration"))
    if len(duration) > 40:
        _bad("Duration is too long (max 40 characters)")
    vm = None if _blank(raw.get("validityMonths")) else _num(raw.get("validityMonths"))
    if not _blank(raw.get("validityMonths")) and not (vm is not None and vm == int(vm) and 1 <= vm <= 60):
        _bad("Validity must be whole months from 1 to 60 (or blank)")
    inc_raw = raw.get("inclusions")
    inc = [_clean(x) for x in (inc_raw if isinstance(inc_raw, list) else re.split(r"\r?\n|;", str(inc_raw or "")))]
    inc = [x for x in inc if x]
    if len(inc) > 15:
        _bad("Up to 15 inclusion lines")
    if any(len(x) > 160 for x in inc):
        _bad("An inclusion line is too long (max 160 characters)")
    return {"code": code or None, "name": {"en": name, "ms": name}, "items": items, "sessions": sessions, "price": L.r2(price),
            "duration": duration or None, "validityMonths": int(vm) if vm is not None else None, "inclusions": inc}
