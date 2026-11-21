"""Seed CLINIC SETUP ONLY (no patients): chart of accounts, SST settings (not registered), units, practitioners,
services (price list incl. wellness offers), packages, stock with cost prices and the first admin user.

    uv run python -m app.seed                      # uses ADMIN_EMAIL / ADMIN_PASSWORD (or the demo defaults)
    uv run python -m app.seed --admin-email you@clinic.my --admin-password 'Str0ng!pass'

Safe to run again: runs on every start. Accounts, units and practitioners are refreshed from seed_data.json;
therapies, packages and stock are the clinic's own once live (edited in the app), so only missing ones are added.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from sqlmodel import Session, select

from . import ledger as L
from .auth import hash_password
from .db import engine
from .models import Account, ClinicSettings, InventoryItem, Package, Practitioner, Service, Unit, User

DATA = json.loads((Path(__file__).parent / "seed_data.json").read_text())


def upsert(s: Session, model, key: str, values: dict) -> None:
    row = s.get(model, key)
    if row:
        for k, v in values.items():
            setattr(row, k, v)
    else:
        row = model(**values)
    s.add(row)


def run(admin_email: str, admin_password: str, admin_name: str = "Clinic Admin") -> None:
    with Session(engine) as s:
        for a in L.COA:
            upsert(s, Account, a["code"], {"code": a["code"], "name": a["name"], "type": a["type"], "grp": a["group"]})
        if not s.get(ClinicSettings, 1):
            s.add(ClinicSettings(id=1, clinic=DATA["CLINIC"], sst=dict(L.DEFAULT_SST)))
        for u in DATA["UNITS"]:
            upsert(s, Unit, u["id"], {"id": u["id"], "type": u["type"], "name": u["name"]})
        s.flush()
        for unit, people in DATA["PRACTITIONERS"].items():
            for p in people:
                upsert(s, Practitioner, p["id"], {"id": p["id"], "unit_id": unit, "name": p["name"], "role": p["role"]})
        wellness = {w["id"]: w for w in DATA["WELLNESS"]}
        for unit_type, services in DATA["SERVICES"].items():
            for x in services:
                w = wellness.get(x["id"])
                if s.get(Service, x["id"]):    # the clinic's own once live: never overwritten or brought back after delete
                    continue
                upsert(s, Service, x["id"], {"id": x["id"], "unit_type": unit_type, "code": x.get("code"), "group": x.get("group"), "name": x["name"], "price": x["price"],
                                             "normal_price": x.get("normal"), "offer_label": x.get("label"), "wellness": bool(w), "mins": (w or x).get("mins"),
                                             "benefits": (w or {}).get("benefits"), "advance_booking": bool((w or {}).get("advance"))})
        for g in DATA["PACKAGES"]:
            if not s.get(Package, g["id"]):
                s.add(Package(id=g["id"], name=g["name"], sessions=g["sessions"], price=g["price"], items=g.get("items", []), code=g.get("code"),
                              duration=g.get("duration"), validity_months=g.get("validityMonths"), inclusions=g.get("inclusions", [])))
        for n, i in enumerate(DATA["INVENTORY"]):
            if not s.get(InventoryItem, i["id"]):   # stock levels are the clinic's own once live: never overwritten
                s.add(InventoryItem(id=i["id"], name=i["name"], form=i["form"], unit=i["unit"], stock=i["stock"], reorder_level=i["reorder"], price=i["price"],
                                    cost=i.get("cost", 0), batch=i.get("batch"), expiry=i.get("exp"), base_oil=i.get("base"), contra=i.get("contra", []),
                                    has_sugar=bool(i.get("sugar")), used_for=i.get("use", "both"), sort=n))
        if not s.exec(select(User).where(User.email == admin_email.lower())).first():
            s.add(User(email=admin_email.lower(), name=admin_name, password_hash=hash_password(admin_password), role="admin"))
        s.commit()
    print(f"seeded clinic setup (no patients) · admin {admin_email}")


from .roles import ROLES


def add_user(email: str, password: str, name: str, role: str) -> None:
    if role not in ROLES:
        raise SystemExit(f"role must be one of: {', '.join(sorted(ROLES))}")
    with Session(engine) as s:
        if s.exec(select(User).where(User.email == email.lower())).first():
            raise SystemExit(f"{email} already exists")
        s.add(User(email=email.lower(), name=name, password_hash=hash_password(password), role=role))
        s.commit()
    print(f"added {role} {email}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--admin-email", default=os.environ.get("ADMIN_EMAIL", "admin@dhanwanthari.test"))
    ap.add_argument("--admin-password", default=os.environ.get("ADMIN_PASSWORD", "Dhanwanthari@2026"))
    ap.add_argument("--add-user", nargs=4, metavar=("EMAIL", "PASSWORD", "NAME", "ROLE"), help="add a staff login: role = vaidya|therapist|front|pharmacist|finance|admin")
    a = ap.parse_args()
    if a.add_user:
        add_user(*a.add_user)
    else:
        run(a.admin_email, a.admin_password)
