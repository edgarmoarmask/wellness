"""Clinic business rules — same rules as the web app's src/lib/rules.js, enforced on the server (source of truth)."""
from __future__ import annotations

import calendar

import math
from datetime import date

POLICY = {"minDepositPct": 30, "balanceDueDays": 30}

# visit status machine: booked → waiting → consult → dispense / billing → done
NEXT = {"booked": ["waiting", "cancelled"], "waiting": ["consult", "cancelled"], "consult": ["dispense", "billing"], "dispense": ["billing"], "billing": ["done"]}


def can_move(src: str, dst: str) -> bool:
    return dst in NEXT.get(src, [])


def r2(n: float) -> float:
    """JS Math.round(n * 100) / 100."""
    return math.floor(n * 100 + 0.5) / 100


def session_value(price: float, sessions: int) -> float:
    return r2(float(price) / sessions)


def reorder_qty(stock: int, reorder_level: int) -> int:
    return max(0, reorder_level * 2 - stock)


def min_deposit(price: float) -> int:
    return math.ceil(float(price) * POLICY["minDepositPct"] / 100)


def safety_check(item, qty: int, patient) -> dict:
    """Prescription safety. {'block': msg} refuses the medicine, {'warn': msg} allows it with a warning.
    - sesame-based thailam + recorded sesame allergy → block
    - pregnancy contraindication + pregnant flag → block
    - quantity above stock → block
    - sugar-based lehyam + diabetes → warn
    """
    allergy = (patient.allergy or "").lower()
    flags = patient.flags or []
    if item.base_oil == "sesame" and "sesame" in allergy:
        return {"block": f"{item.name} is sesame-oil based and the patient has a recorded sesame allergy. Not added. Choose a coconut-based oil such as Murivenna."}
    if "pregnancy" in (item.contra or []) and "pregnant" in flags:
        return {"block": f"{item.name} is not advised in pregnancy. Not added."}
    if qty > item.stock:
        return {"block": f"Only {item.stock} in stock."}
    if item.has_sugar and "diabetes" in flags:
        return {"warn": f"{item.name} contains sugar and the patient has diabetes. Added — review the dose."}
    return {}


def add_months(iso_day: str, n: int) -> str:
    """'2026-11-30' + 3 months → '2027-02-28' (day clamped to the month's end). Same as the app's addMonths()."""
    y, m, d = (int(x) for x in iso_day[:10].split("-"))
    t = (m - 1) + n
    yy, mm = y + t // 12, t % 12 + 1
    last = calendar.monthrange(yy, mm)[1]
    return f"{yy:04d}-{mm:02d}-{min(d, last):02d}"


def package_state(price: float, sessions: int, used: int, paid: float, sold_on: str, today: date | None = None, validity_months: int | None = None) -> dict:
    """Full payment unlocks every session; partial payment unlocks floor(paid ÷ value per session).
    Validity: usable until the sale date + N months (inclusive)."""
    paid = r2(paid)
    balance = r2(max(0.0, float(price) - paid))
    per = session_value(price, sessions)
    unlocked = sessions if balance <= 0 else min(sessions, math.floor((paid + 0.005) / per))
    today = today or date.today()
    age = (today - date.fromisoformat(sold_on)).days
    left = sessions - used
    expires = add_months(sold_on, validity_months) if validity_months else None
    expired = bool(expires) and today.isoformat() > expires
    return {"paid": paid, "balance": balance, "per": per, "unlocked": unlocked, "left": left, "expiresOn": expires, "expired": expired,
            "canUse": left > 0 and used < unlocked and not expired, "fully": balance <= 0, "overdue": balance > 0 and age > POLICY["balanceDueDays"]}


def check_payment(price: float, already_paid: float, amount: float, first: bool) -> str | None:
    bal = r2(float(price) - already_paid)
    if not amount or amount <= 0:
        return "Enter an amount."
    if amount > bal + 0.001:
        return f"More than the balance (RM{bal:.2f})."
    if first and amount < min_deposit(price):
        return f"Minimum deposit is RM{min_deposit(price)} ({POLICY['minDepositPct']}%)."
    return None


def total(lines: list[dict]) -> float:
    return r2(sum(ln["q"] * ln["p"] for ln in lines))
