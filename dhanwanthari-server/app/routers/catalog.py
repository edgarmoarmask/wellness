"""Therapy menu and packages: add / edit / delete / CSV import (same rules as the web app, see app/catalog.py).
Delete = archive: past visits, invoices and sold packages keep their names and terms."""
from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from .. import catalog as C
from ..auth import CurrentUser, can, current_user
from ..db import get_session
from ..errors import ApiError, not_found
from ..models import Package, Service
from ..posting import audit

router = APIRouter(prefix="/api")
EDITORS: tuple = ()           # admin only; everyone else reads the menu


def service_out(x: Service) -> dict:
    return {"id": x.id, "code": x.code, "group": x.group, "name": x.name, "mins": x.mins, "price": x.price, "normal": x.normal_price, "label": x.offer_label,
            "wellness": x.wellness, "benefits": x.benefits, "advance": x.advance_booking, "archived": not x.active}


def package_out(g: Package) -> dict:
    return {"id": g.id, "code": g.code, "name": g.name, "items": g.items or [], "sessions": g.sessions, "price": g.price, "duration": g.duration,
            "validityMonths": g.validity_months, "inclusions": g.inclusions or [], "archived": not g.active}


def _therapies(s: Session) -> list[Service]:
    return list(s.exec(select(Service).where(Service.unit_type == "therapy").order_by(Service.id)))


def _t_index(s: Session) -> list[dict]:
    return [{"id": x.id, "code": x.code, "name": x.name.get("en", ""), "active": x.active} for x in _therapies(s)]


def _apply_service(x: Service, d: dict) -> None:
    x.code, x.group, x.name, x.mins, x.price, x.normal_price, x.offer_label = d["code"], d["group"], d["name"], d["mins"], d["price"], d["normal"], d["label"]
    x.wellness, x.benefits, x.advance_booking = d["wellness"], d["benefits"], d["advance"]


def _next_id(s: Session, model, prefix: str) -> str:
    nums = [int(i[len(prefix):]) for i in s.exec(select(model.id)) if i.startswith(prefix) and i[len(prefix):].isdigit()]
    return f"{prefix}{max(nums, default=0) + 1}"


class TherapyIn(BaseModel):
    code: Any = None
    name: Any = None                   # text or {"en": ...}
    group: Any = None
    mins: Any = None
    price: Any = None
    normal: Any = None
    label: Any = None
    benefits: Any = None
    advance: bool = False


@router.get("/services")
def list_services(all: bool = False, s: Session = Depends(get_session), _: CurrentUser = Depends(current_user)):
    """Therapy menu. ?all=true also returns deleted therapies (past records refer to them)."""
    return [service_out(x) for x in _therapies(s) if all or x.active]


def _others_t(s: Session):
    return [t for t in _t_index(s) if t["active"]]


def _create_service(s: Session, d: dict, user: CurrentUser) -> Service:
    x = Service(id=_next_id(s, Service, "th"), unit_type="therapy", name=d["name"], price=d["price"])
    _apply_service(x, d)
    s.add(x)
    s.flush()
    audit(s, user.id, "therapy.create", "service", x.id, {"name": d["name"]["en"], "price": d["price"]})
    return x


@router.post("/services", status_code=201)
def create_service(b: TherapyIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can(*EDITORS))):
    d = C.check_therapy(b.model_dump(), item_id=None, others=_others_t(s))
    return service_out(_create_service(s, d, user))


def _get_therapy(s: Session, sid: str) -> Service:
    x = s.get(Service, sid)
    if not x or x.unit_type != "therapy" or not x.active:
        raise not_found("Therapy")
    return x


@router.put("/services/{sid}")
def update_service(sid: str, b: TherapyIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can(*EDITORS))):
    x = _get_therapy(s, sid)
    d = C.check_therapy(b.model_dump(), item_id=sid, others=_others_t(s))
    before = {"name": x.name.get("en"), "price": x.price}
    _apply_service(x, d)
    s.add(x)
    audit(s, user.id, "therapy.update", "service", sid, {"before": before, "after": {"name": d["name"]["en"], "price": d["price"]}})
    return service_out(x)


@router.delete("/services/{sid}")
def delete_service(sid: str, s: Session = Depends(get_session), user: CurrentUser = Depends(can(*EDITORS))):
    x = _get_therapy(s, sid)
    used = [g.name.get("en", g.id) for g in s.exec(select(Package).where(Package.active == True)) if any(i.get("svc") == sid for i in (g.items or []))]  # noqa: E712
    if used:
        many = len(used) > 1
        raise ApiError(409, "in_use", f"Used in package{'s' if many else ''}: {', '.join(used)}. Remove it from {'those packages' if many else 'that package'} first.")
    x.active = False
    s.add(x)
    audit(s, user.id, "therapy.delete", "service", sid, {"name": x.name.get("en")})
    return {"ok": True}


class ImportIn(BaseModel):
    rows: list[dict] = Field(min_length=1, max_length=2000)


def _row_line(raw: dict, k: int):
    return raw.get("line") or k + 2


@router.post("/services/import")
def import_services(b: ImportIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can(*EDITORS))):
    """All-or-nothing. Row with id updates that therapy; without id it matches by name, else adds."""
    errors, plan, others, seen = [], [], _others_t(s), set()
    by_name = {o["name"].lower(): o["id"] for o in others}
    for k, raw in enumerate(b.rows):
        line = _row_line(raw, k)
        rid = raw.get("id") or by_name.get(C._clean(raw.get("name")).lower())
        x = s.get(Service, rid) if rid else None
        if raw.get("id") and (not x or not x.active or x.unit_type != "therapy"):
            errors.append({"row": line, "message": f"No therapy with id {raw['id']}. Leave id blank to add a new therapy."})
            continue
        try:
            d = C.check_therapy(raw, item_id=x.id if x else None, others=others)
        except ApiError as e:
            errors.append({"row": line, "message": e.message})
            continue
        keys = {x.id if x else "", "n:" + d["name"]["en"].lower()} | ({"c:" + d["code"]} if d["code"] else set())
        keys.discard("")
        if keys & seen:
            errors.append({"row": line, "message": "This therapy appears more than once in the file"})
            continue
        seen |= keys
        plan.append((x, d))
        if not x:
            others.append({"id": "new", "code": d["code"], "name": d["name"]["en"]})
    if errors:
        raise ApiError(400, "invalid", f"{len(errors)} row(s) need fixing. Nothing was imported.", errors=errors)
    added = updated = 0
    for x, d in plan:
        if x:
            _apply_service(x, d)
            s.add(x)
            audit(s, user.id, "therapy.import", "service", x.id, {"name": d["name"]["en"], "price": d["price"]})
            updated += 1
        else:
            _create_service(s, d, user)
            added += 1
    return {"added": added, "updated": updated}


# ---------------------------------------------------------------- packages
class PackageIn(BaseModel):
    code: Any = None
    name: Any = None
    price: Any = None
    items: list[dict] = []
    sessions: Any = None              # flexible packages (no items)
    duration: Any = None
    validityMonths: Any = None
    inclusions: Any = None


def _others_p(s: Session) -> list[dict]:
    return [{"id": g.id, "code": g.code, "name": g.name.get("en", "")} for g in s.exec(select(Package).where(Package.active == True))]  # noqa: E712


@router.get("/packages")
def list_packages(all: bool = False, s: Session = Depends(get_session), _: CurrentUser = Depends(current_user)):
    return [package_out(g) for g in s.exec(select(Package).order_by(Package.price)) if all or g.active]


def _create_package(s: Session, d: dict, user: CurrentUser) -> Package:
    g = Package(id=_next_id(s, Package, "pkg"), name=d["name"], sessions=d["sessions"], price=d["price"], items=d["items"], code=d["code"],
                duration=d["duration"], validity_months=d["validityMonths"], inclusions=d["inclusions"])
    s.add(g)
    s.flush()
    audit(s, user.id, "package.create", "package", g.id, {"name": d["name"]["en"], "price": d["price"], "items": d["items"]})
    return g


@router.post("/packages", status_code=201)
def create_package(b: PackageIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can(*EDITORS))):
    d = C.check_package(b.model_dump(), item_id=None, others=_others_p(s), therapies=_t_index(s))
    return package_out(_create_package(s, d, user))


def _get_package(s: Session, gid: str) -> Package:
    g = s.get(Package, gid)
    if not g or not g.active:
        raise not_found("Package")
    return g


def _apply_package(s: Session, g: Package, d: dict, user: CurrentUser, action: str) -> None:
    before = {"name": g.name.get("en"), "price": g.price, "items": g.items}
    g.name, g.sessions, g.price, g.items, g.code = d["name"], d["sessions"], d["price"], d["items"], d["code"]
    g.duration, g.validity_months, g.inclusions = d["duration"], d["validityMonths"], d["inclusions"]
    s.add(g)
    audit(s, user.id, action, "package", g.id, {"before": before, "after": {"name": d["name"]["en"], "price": d["price"], "items": d["items"]}})


@router.put("/packages/{gid}")
def update_package(gid: str, b: PackageIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can(*EDITORS))):
    """Applies to new sales only: each sold package keeps a copy of its terms."""
    g = _get_package(s, gid)
    d = C.check_package(b.model_dump(), item_id=gid, others=_others_p(s), therapies=_t_index(s))
    _apply_package(s, g, d, user, "package.update")
    return package_out(g)


@router.delete("/packages/{gid}")
def delete_package(gid: str, s: Session = Depends(get_session), user: CurrentUser = Depends(can(*EDITORS))):
    """Stops selling it. Clients who bought it keep their sessions on the terms they paid for."""
    g = _get_package(s, gid)
    g.active = False
    s.add(g)
    audit(s, user.id, "package.delete", "package", gid, {"name": g.name.get("en")})
    return {"ok": True}


@router.post("/packages/import")
def import_packages(b: ImportIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can(*EDITORS))):
    """All-or-nothing. Each row is one whole package {id?, name, price, items:[{svc, n}]}; the web app groups the CSV lines."""
    errors, plan, others, seen, ther = [], [], _others_p(s), set(), _t_index(s)
    by_name = {o["name"].lower(): o["id"] for o in others}
    for k, raw in enumerate(b.rows):
        line = _row_line(raw, k)
        rid = raw.get("id") or by_name.get(C._clean(raw.get("name")).lower())
        g = s.get(Package, rid) if rid else None
        if raw.get("id") and (not g or not g.active):
            errors.append({"row": line, "message": f"No package with id {raw['id']}. Leave package_id blank to add a new package."})
            continue
        try:
            d = C.check_package(raw, item_id=g.id if g else None, others=others, therapies=ther)
        except ApiError as e:
            errors.append({"row": line, "message": e.message})
            continue
        key = g.id if g else "n:" + d["name"]["en"].lower()
        if key in seen:
            errors.append({"row": line, "message": "This package appears more than once in the file"})
            continue
        seen.add(key)
        plan.append((g, d))
        if not g:
            others.append({"id": "new", "code": d["code"], "name": d["name"]["en"]})
    if errors:
        raise ApiError(400, "invalid", f"{len(errors)} package(s) need fixing. Nothing was imported.", errors=errors)
    added = updated = 0
    for g, d in plan:
        if g:
            _apply_package(s, g, d, user, "package.import")
            updated += 1
        else:
            _create_package(s, d, user)
            added += 1
    return {"added": added, "updated": updated}
