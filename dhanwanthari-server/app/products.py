"""Pharmacy products: checks and the journal entries a stock change needs.
Same rules and messages as the web app's src/lib/products.js."""
import re
from datetime import date

from . import ledger as L
from .errors import ApiError

FORMS = ["thailam", "kashayam", "arishtam", "choornam", "lehyam", "gulika", "other"]
USES = ["dispense", "therapy", "both"]
BASES = ["", "sesame", "coconut", "other"]


def iso_date(v) -> str | None:
    """'2027-03-31' or '31/03/2027' → '2027-03-31'; '' → ''; anything else → None"""
    s = str(v or "").strip()
    if not s:
        return ""
    m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        y, mo, d = m.groups()
    else:
        m = re.fullmatch(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})", s)
        if not m:
            return None
        d, mo, y = m.groups()
    try:
        return date(int(y), int(mo), int(d)).isoformat()
    except ValueError:
        return None


def _num(v):
    if v is None or v == "":
        return None
    try:
        return float(re.sub(r"[, ]|RM", "", str(v), flags=re.I))
    except ValueError:
        return None


def _int(v):
    n = _num(v)
    return int(n) if n is not None and n == int(n) else None


def check_product(raw: dict, *, item_id: str | None, others: list) -> dict:
    """raw uses the app's names (name, form, unit, stock, reorder, price, cost, batch, exp, base, sugar, contra, use).
    `others` = active products as (id, name). Raises ApiError(400) with the same message the app shows."""
    def bad(msg):
        raise ApiError(400, "invalid", msg, issues=[{"path": "product", "message": msg}])
    name = re.sub(r"\s+", " ", str(raw.get("name") or "").strip())
    if len(name) < 2:
        bad("Enter the product name")
    if len(name) > 120:
        bad("Product name is too long (max 120 characters)")
    if any(i != item_id and n.strip().lower() == name.lower() for i, n in others):
        bad(f'A product called "{name}" already exists')
    form = str(raw.get("form") or "").strip().lower()
    if form not in FORMS:
        bad(f"Form must be one of: {', '.join(FORMS)}")
    unit = str(raw.get("unit") or "").strip().lower()
    if not unit:
        bad("Enter the unit (bottle, jar, pack…)")
    stock, reorder = _int(raw.get("stock", 0) if raw.get("stock") != "" else 0), _int(raw.get("reorder", 0) if raw.get("reorder") != "" else 0)
    price, cost = _num(raw.get("price")), _num(raw.get("cost") if raw.get("cost") not in (None, "") else 0)
    if stock is None or stock < 0:
        bad("Stock must be a whole number, 0 or more")
    if reorder is None or reorder < 0:
        bad("Reorder level must be a whole number, 0 or more")
    if price is None or price < 0:
        bad("Enter the selling price (RM)")
    if cost is None or cost < 0:
        bad("Cost price must be 0 or more (RM)")
    exp = iso_date(raw.get("exp"))
    if exp is None:
        bad("Expiry must be a date like 2027-03-31 or 31/03/2027")
    base = str(raw.get("base") or "").strip().lower()
    if base not in BASES:
        bad("Base oil must be sesame, coconut, other or blank")
    use = str(raw.get("use") or "both").strip().lower()
    if use not in USES:
        bad("Use for must be dispense, therapy or both")
    contra = list(dict.fromkeys(str(c).strip().lower() for c in (raw.get("contra") or []) if str(c).strip()))
    return {"name": name, "form": form, "unit": unit, "stock": stock, "reorder": reorder, "price": L.r2(price), "cost": L.r2(cost),
            "batch": str(raw.get("batch") or "").strip(), "exp": exp, "base": base or None, "sugar": bool(raw.get("sugar")), "contra": contra, "use": use}


def postings(before: dict | None, after: dict | None) -> list[dict]:
    """Same entries as productPostings() in the app (descriptions identical)."""
    out = []

    def add(d, dr, cr, amt):
        if L.r2(amt) > 0.004:
            out.append({"d": d, "dr": dr, "cr": cr, "amt": L.r2(amt)})
    A = L.A
    if before is None:
        add(f"Opening stock · {after['name']} × {after['stock']}", A["inventory"], A["capital"], after["stock"] * after["cost"])
        return out
    if after is None:
        add(f"Product deleted · stock written off · {before['name']} × {before['stock']}", A["stockAdj"], A["inventory"], before["stock"] * (before["cost"] or 0))
        return out
    old_cost, diff = before["cost"] or 0, after["stock"] - before["stock"]
    if diff > 0:
        add(f"Stock count adjustment · {after['name']} +{diff}", A["inventory"], A["stockAdj"], diff * old_cost)
    if diff < 0:
        add(f"Stock count adjustment · {after['name']} {diff}", A["stockAdj"], A["inventory"], -diff * old_cost)
    reval = after["stock"] * (after["cost"] - old_cost)
    label = f"Stock revalued · {after['name']} cost {old_cost:.2f} → {after['cost']:.2f}"
    if reval > 0:
        add(label, A["inventory"], A["stockAdj"], reval)
    if reval < 0:
        add(label, A["stockAdj"], A["inventory"], -reval)
    return out
