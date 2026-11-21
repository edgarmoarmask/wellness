"""Clinic endpoints: sign-in, setup, patients, queue & visits, prescriptions, pharmacy, billing, packages, dashboard, audit.
JSON shapes match what the web app's live mode sends and expects (src/lib/store.jsx → remote)."""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any, Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func
from sqlmodel import Session, select

from .. import ledger as L
from .. import emails
from .. import products as P
from ..auth import CurrentUser, can, current_user, login, verify
from ..db import get_session, now_utc, next_number, time_my, today_my
from ..errors import ApiError, not_found
from ..models import (AuditLog, ClientPackage, EmailLog, InventoryItem, Invoice, Package, PackagePayment, PackageSession, Patient, Practitioner, RxItem, Service,
                      StockMove, Unit, Visit)
from ..posting import audit, money_in, post, sst_settings
from ..rules import can_move, check_payment, package_state, reorder_qty, safety_check, total

router = APIRouter(prefix="/api")
Method = Literal["cash", "card", "duitnow", "transfer"]


# --------------------------------------------------------------------------- health & sign-in
@router.get("/health")
def health():
    return {"ok": True, "service": "dhanwanthari-server", "time": now_utc().isoformat()}


class LoginIn(BaseModel):
    email: str
    password: str = Field(min_length=1)


class VerifyIn(BaseModel):
    challengeId: str
    code: str = Field(pattern=r"^\d{6}$")


@router.post("/auth/login")
def auth_login(b: LoginIn, s: Session = Depends(get_session)):
    return login(s, b.email, b.password)


@router.post("/auth/verify")
def auth_verify(b: VerifyIn, s: Session = Depends(get_session)):
    return verify(s, b.challengeId, b.code)


@router.get("/me")
def me(user: CurrentUser = Depends(current_user)):
    return user


# --------------------------------------------------------------------------- setup
@router.get("/setup")
def setup(s: Session = Depends(get_session), _: CurrentUser = Depends(current_user)):
    return {
        "units": [u.model_dump() for u in s.exec(select(Unit).order_by(Unit.id))],
        "practitioners": [p.model_dump() for p in s.exec(select(Practitioner).order_by(Practitioner.unit_id, Practitioner.id))],
        "services": [x.model_dump() for x in s.exec(select(Service).where(Service.active == True).order_by(Service.unit_type, Service.id))],  # noqa: E712
        "packages": [p.model_dump() for p in s.exec(select(Package).where(Package.active == True).order_by(Package.price))],  # noqa: E712
        "policy": {"minDepositPct": 30, "balanceDueDays": 30},
    }


# --------------------------------------------------------------------------- patients
class PatientIn(BaseModel):
    name: str
    idType: Literal["mykad", "passport"] = "mykad"
    citizenship: Optional[Literal["citizen", "non-citizen"]] = None     # decides SST; defaults from ID type
    idNo: str
    dob: str = ""
    sex: Literal["F", "M", ""] = ""
    phone: str
    email: str = ""
    address: str = ""
    allergy: str = ""
    flags: list[Literal["diabetes", "hypertension", "pregnant"]] = []
    emergencyName: str = ""
    emergencyPhone: str = ""
    notes: str = ""
    pdpaConsent: bool = False
    heightCm: Any = None              # cm, optional
    weightKg: Any = None              # kg, optional
    bp: Optional[str] = ""            # "120/80", optional

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Enter the full name")
        return v

    @field_validator("idNo")
    @classmethod
    def _id(cls, v: str) -> str:
        v = v.strip().upper()
        if len(v) < 5:
            raise ValueError("Enter the MyKad or passport number")
        return v

    @field_validator("phone")
    @classmethod
    def _phone(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 7:
            raise ValueError("Enter a phone number")
        return v

    @field_validator("dob")
    @classmethod
    def _dob(cls, v: str) -> str:
        if v and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            raise ValueError("Date of birth should be YYYY-MM-DD")
        return v

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        if v and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v):
            raise ValueError("Enter a valid email")
        return v

    @model_validator(mode="after")
    def _rules(self):
        self.heightCm, self.weightKg, self.bp = check_vitals(self.heightCm, self.weightKg, self.bp)
        if not self.pdpaConsent:
            raise ValueError("PDPA consent is required")
        if self.idType == "mykad" and not re.fullmatch(r"\d{6}-?\d{2}-?\d{4}", self.idNo):
            raise ValueError("MyKad should look like 900101-14-5678")
        return self

    def citizenship_or_default(self) -> str:
        return self.citizenship or ("citizen" if self.idType == "mykad" else "non-citizen")


def check_vitals(h, w, bp) -> tuple:
    """height cm, weight kg, blood pressure "120/80" — optional. Same rules and messages as the app's checkVitals()."""
    def num(v):
        if v is None or v == "":
            return None
        try:
            return float(str(v).replace(",", "."))
        except ValueError:
            return float("nan")
    h, w, bp = num(h), num(w), re.sub(r"\s+", "", bp or "")
    if h is not None and not (30 <= h <= 250):
        raise ValueError("Height should be in cm, between 30 and 250.")
    if w is not None and not (1 <= w <= 350):
        raise ValueError("Weight should be in kg, between 1 and 350.")
    out = ""
    if bp:
        m = re.fullmatch(r"(\d{2,3})/(\d{2,3})", bp)
        if not m:
            raise ValueError("Blood pressure should look like 120/80.")
        sys_, dia = int(m[1]), int(m[2])
        if sys_ < 60 or sys_ > 260 or dia < 30 or dia > 160 or sys_ <= dia:
            raise ValueError("Blood pressure looks wrong. Enter it as systolic/diastolic, e.g. 120/80.")
        out = f"{sys_}/{dia}"
    return (round(h, 1) if h is not None else None), (round(w, 1) if w is not None else None), out


def _patient_fields(b: PatientIn) -> dict:
    return dict(name=b.name, citizenship=b.citizenship_or_default(), id_type=b.idType, id_no=b.idNo, dob=b.dob or None, sex=b.sex or None, phone=b.phone,
                email=b.email or None, address=b.address, allergy=b.allergy, flags=list(b.flags), emergency_name=b.emergencyName,
                emergency_phone=b.emergencyPhone, notes=b.notes, height_cm=b.heightCm, weight_kg=b.weightKg, bp=b.bp or None)


def patient_out(p: Patient) -> dict:
    return {"id": p.id, "name": p.name, "citizenship": p.citizenship, "idType": p.id_type, "idNo": p.id_no, "dob": p.dob or "", "sex": p.sex or "",
            "phone": p.phone, "email": p.email or "", "address": p.address or "", "allergy": p.allergy, "flags": p.flags or [],
            "emergencyName": p.emergency_name or "", "emergencyPhone": p.emergency_phone or "", "notes": p.notes or "", "pdpaConsent": True,
            "heightCm": p.height_cm, "weightKg": p.weight_kg, "bp": p.bp or "",
            "created": p.created_at.isoformat() if p.created_at else None, "updated": p.updated_at.isoformat() if p.updated_at else None}


@router.get("/patients")
def list_patients(q: str = "", s: Session = Depends(get_session), _: CurrentUser = Depends(current_user)):
    term = f"%{q.strip().lower()}%"
    rows = s.exec(select(Patient).where((func.lower(Patient.name).like(term)) | (func.lower(Patient.id_no).like(term)) | (Patient.phone.like(term)) | (func.lower(Patient.id).like(term)))  # type: ignore[attr-defined]
                  .order_by(Patient.created_at.desc()).limit(200)).all()  # type: ignore[attr-defined]
    last = dict(s.exec(select(Visit.patient_id, func.max(Visit.visit_date)).where(Visit.status == "done").group_by(Visit.patient_id)).all())
    return [{**patient_out(p), "lastVisit": last.get(p.id)} for p in rows]


@router.post("/patients", status_code=201)
def create_patient(b: PatientIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can("cashier", "bams", "therapist"))):
    if s.exec(select(Patient).where(Patient.id_no == b.idNo)).first():
        raise ApiError(409, "duplicate", "A patient with this ID number is already registered.")
    pid = f"DV-{next_number(s, 'patient'):05d}"
    s.add(Patient(id=pid, **_patient_fields(b), pdpa_consent_at=now_utc(), created_by=user.id))
    audit(s, user.id, "patient.create", "patient", pid)
    return {"id": pid}


@router.put("/patients/{pid}")
def update_patient(pid: str, b: PatientIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can("cashier", "bams", "therapist"))):
    p = s.get(Patient, pid)
    if not p:
        raise not_found("Patient")
    dup = s.exec(select(Patient).where(Patient.id_no == b.idNo, Patient.id != pid)).first()
    if dup:
        raise ApiError(409, "duplicate", "A patient with this ID number is already registered.")
    for k, v in _patient_fields(b).items():
        setattr(p, k, v)
    p.updated_at = now_utc()
    s.add(p)
    audit(s, user.id, "patient.update", "patient", pid)
    return {"id": pid}


def packages_for(s: Session, patient_id: str | None = None) -> list[dict]:
    q = select(ClientPackage).order_by(ClientPackage.sold_on.desc())  # type: ignore[attr-defined]
    if patient_id:
        q = q.where(ClientPackage.patient_id == patient_id)
    out = []
    for k in s.exec(q):
        pays = s.exec(select(PackagePayment).where(PackagePayment.client_package_id == k.id).order_by(PackagePayment.id)).all()
        paid = sum(p.amount for p in pays)
        usage: dict[str, int] = {}
        for x in s.exec(select(PackageSession).where(PackageSession.client_package_id == k.id)):
            if x.service_id:
                usage[x.service_id] = usage.get(x.service_id, 0) + 1
        items = [{**i, "used": usage.get(i["svc"], 0), "left": max(0, i["n"] - usage.get(i["svc"], 0))} for i in (k.items or [])]
        out.append({"id": k.id, "patient_id": k.patient_id, "package_id": k.package_id, "name": k.name, "used": k.used, "sessions": k.sessions, "price": k.price,
                    "sold_on": k.sold_on, "plan": k.plan, "payments": [{"paid_on": p.paid_on, "amount": p.amount, "method": p.method} for p in pays],
                    "items": items, "usage": usage, "validityMonths": k.validity_months,
                    **package_state(k.price, k.sessions, k.used, paid, k.sold_on, date.fromisoformat(today_my()), k.validity_months)})
    return out


def session_therapy(s: Session, k: dict, svc: str | None) -> str | None:
    """Which therapy a package session is for (same rule as the app's sessionTherapy). None for packages without a therapy list."""
    if not k["items"]:
        return None
    open_ = [i for i in k["items"] if i["left"] > 0]
    name = lambda sid: (s.get(Service, sid).name.get("en") if s.get(Service, sid) else sid)  # noqa: E731
    if not svc:
        if len(open_) == 1:
            return open_[0]["svc"]
        raise ApiError(409, "choose_therapy", "Choose which therapy this session is for.")
    it = next((i for i in k["items"] if i["svc"] == svc), None)
    if not it:
        raise ApiError(409, "not_in_package", f"{name(svc)} is not part of this package.")
    if it["left"] <= 0:
        raise ApiError(409, "therapy_used_up", f"All {it['n']} {name(svc)} sessions on this package are used.")
    return svc


@router.get("/patients/{pid}")
def get_patient(pid: str, s: Session = Depends(get_session), user: CurrentUser = Depends(current_user)):
    """Full record: details, visits with notes + medicines, packages + payments, invoices. Viewing is audited (PDPA)."""
    p = s.get(Patient, pid)
    if not p:
        raise not_found("Patient")
    visits = []
    for v in s.exec(select(Visit).where(Visit.patient_id == pid).order_by(Visit.visit_date.desc(), Visit.slot.desc())):  # type: ignore[attr-defined]
        meds = [{"item_id": r.item_id, "qty": r.qty, "warning": r.warning} for r in s.exec(select(RxItem).where(RxItem.visit_id == v.id))]
        inv = s.exec(select(Invoice.id).where(Invoice.visit_id == v.id)).first()
        visits.append({"id": v.id, "visit_date": v.visit_date, "slot": v.slot, "unit_id": v.unit_id, "practitioner_id": v.practitioner_id, "status": v.status,
                       "service_id": v.service_id, "diagnosis": v.diagnosis, "dosha": v.dosha, "notes": v.notes, "mc_days": v.mc_days, "medicines": meds, "invoice_id": inv})
    invoices = [{"id": i.id, "issued_on": i.issued_on, "subtotal": i.subtotal, "sst": i.sst, "total": i.total, "method": i.method, "status": i.status, "lines": i.lines}
                for i in s.exec(select(Invoice).where(Invoice.patient_id == pid).order_by(Invoice.issued_on.desc(), Invoice.id.desc()))]  # type: ignore[attr-defined]
    audit(s, user.id, "patient.view", "patient", pid)
    return {"patient": patient_out(p), "visits": visits, "packages": packages_for(s, pid), "invoices": invoices}


# --------------------------------------------------------------------------- queue & visits
@router.get("/queue")
def queue(date_: str | None = Query(None, alias="date"), unit: str | None = None, s: Session = Depends(get_session), _: CurrentUser = Depends(current_user)):
    q = select(Visit, Patient).join(Patient, Patient.id == Visit.patient_id).where(Visit.visit_date == (date_ or today_my()), Visit.status != "cancelled", Visit.cleared_at == None)  # noqa: E711
    if unit:
        q = q.where(Visit.unit_id == unit)
    return [{**v.model_dump(), "patient_name": p.name, "allergy": p.allergy, "flags": p.flags} for v, p in s.exec(q.order_by(Visit.slot))]


class VisitIn(BaseModel):
    patientId: str
    unitId: Literal["opd", "tx"]
    practitionerId: str
    serviceId: Optional[str] = None
    packageServiceId: Optional[str] = None   # package session: which therapy of the package
    kind: Literal["walkin", "appt"]
    slot: Optional[str] = Field(default=None, pattern=r"^\d{2}:\d{2}$")
    room: Optional[str] = None
    date: Optional[str] = None              # appointments: YYYY-MM-DD, today up to a year ahead; walk-ins are always today

    @model_validator(mode="after")
    def _date(self):
        today = date.fromisoformat(today_my())
        if self.kind == "walkin" or not self.date:
            self.date = today.isoformat()
            return self
        try:
            d = date.fromisoformat(self.date)
        except ValueError:
            raise ValueError("Appointment date should be YYYY-MM-DD") from None
        if d < today:
            raise ValueError("Appointment date can't be in the past")
        if (d - today).days > 365:
            raise ValueError("Appointments can be booked up to a year ahead")
        if d == today and self.slot and self.slot < time_my()[:5]:
            raise ValueError("That time today has already passed")
        return self


@router.post("/visits", status_code=201)
def create_visit(b: VisitIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can("cashier", "therapist", "bams"))):
    if not s.get(Patient, b.patientId):
        raise not_found("Patient")
    pkg, pk_svc = None, None
    if b.serviceId == "session":
        active = [k for k in packages_for(s, b.patientId) if k["left"] > 0 and not k["expired"]]
        if not active:
            raise ApiError(409, "no_package", "This patient has no active package.")
        first_err = None
        for k in active:
            try:
                pk_svc = session_therapy(s, k, b.packageServiceId)
                pkg = k["id"]
                break
            except ApiError as e:
                first_err = first_err or e
        if not pkg:
            raise first_err
    elif b.serviceId and b.unitId == "tx":
        sv = s.get(Service, b.serviceId)
        if not sv or not sv.active:
            raise not_found("Therapy")
    walk = b.kind == "walkin"
    v = Visit(patient_id=b.patientId, unit_id=b.unitId, practitioner_id=b.practitionerId, room=b.room or ("R1" if b.unitId == "tx" else "C1"),
              visit_date=b.date or today_my(), slot=b.slot or time_my(), kind=b.kind, status="waiting" if walk else "booked",
              service_id=b.serviceId or (None if b.unitId == "tx" else "cons"), client_package_id=pkg, package_service_id=pk_svc, checked_in_at=now_utc() if walk else None)
    s.add(v)
    s.flush()
    audit(s, user.id, "visit.create", "visit", v.id, {"patient": b.patientId})
    return {"id": v.id}


def move_visit(s: Session, vid: str, to: str) -> Visit:
    v = s.get(Visit, vid)
    if not v:
        raise not_found("Visit")
    if not can_move(v.status, to):
        raise ApiError(409, "bad_state", f"Visit is {v.status}; cannot move to {to}.")
    v.status = to
    if to == "waiting":
        v.checked_in_at = now_utc()
    if to == "consult":
        v.started_at = now_utc()
    if to in ("dispense", "billing") and not v.completed_at:
        v.completed_at = now_utc()
    s.add(v)
    return v


@router.post("/visits/{vid}/check-in")
def check_in(vid: str, s: Session = Depends(get_session), _: CurrentUser = Depends(can("cashier"))):
    move_visit(s, vid, "waiting")
    return {"ok": True}


@router.post("/visits/{vid}/cancel")
def cancel_visit(vid: str, s: Session = Depends(get_session), _: CurrentUser = Depends(can("cashier"))):
    move_visit(s, vid, "cancelled")
    return {"ok": True}


@router.delete("/visits/{vid}")
def delete_appointment(vid: str, s: Session = Depends(get_session), user: CurrentUser = Depends(can("cashier"))):
    """Delete an appointment that hasn't been checked in. Kept in the audit log."""
    v = s.get(Visit, vid)
    if not v:
        raise not_found("Appointment")
    if v.status != "booked":
        raise ApiError(409, "not_deletable", "Only appointments that haven't been checked in can be deleted.")
    audit(s, user.id, "visit.delete", "visit", vid, {"patient": v.patient_id, "date": v.visit_date, "time": v.slot, "unit": v.unit_id})
    s.delete(v)
    return {"ok": True}


class ClearIn(BaseModel):
    unitId: Literal["opd", "tx"]
    date: Optional[str] = None


@router.post("/queue/clear")
def clear_queue(b: ClearIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can("cashier"))):
    """Clears a day's queue for one unit: removes entries not started (booked / waiting) and hides finished visits
    (they stay in patient records). Visits in consultation, pharmacy or billing stay until finished."""
    day = b.date or today_my()
    removed = hidden = 0
    kept = 0
    for v in s.exec(select(Visit).where(Visit.visit_date == day, Visit.unit_id == b.unitId, Visit.status != "cancelled")):
        if v.status in ("booked", "waiting"):
            s.delete(v)
            removed += 1
        elif v.status == "done" and not v.cleared_at:
            v.cleared_at = now_utc()
            s.add(v)
            hidden += 1
        elif v.status not in ("done",):
            kept += 1
    audit(s, user.id, "queue.clear", "queue", f"{day}:{b.unitId}", {"removed": removed, "hidden": hidden, "kept": kept})
    return {"removed": removed, "hidden": hidden, "kept": kept}


@router.post("/visits/{vid}/start")
def start_visit(vid: str, s: Session = Depends(get_session), _: CurrentUser = Depends(can("bams", "therapist"))):
    move_visit(s, vid, "consult")
    return {"ok": True}


class NotesIn(BaseModel):
    serviceId: Optional[str] = None
    diagnosis: Optional[str] = None
    dosha: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=4000)
    mcDays: Optional[int] = Field(default=None, ge=0, le=30)


@router.put("/visits/{vid}/notes")
def visit_notes(vid: str, b: NotesIn, s: Session = Depends(get_session), _: CurrentUser = Depends(can("bams", "therapist"))):
    v = s.get(Visit, vid)
    if not v or v.status != "consult":
        raise ApiError(409, "bad_state", "Notes can only be changed during the consultation.")
    for field, val in (("service_id", b.serviceId), ("diagnosis", b.diagnosis), ("dosha", b.dosha), ("notes", b.notes), ("mc_days", b.mcDays)):
        if val is not None:
            setattr(v, field, val)
    s.add(v)
    return {"ok": True}


class RxIn(BaseModel):
    itemId: str
    qty: int = Field(ge=1, le=50)


@router.post("/visits/{vid}/rx", status_code=201)
def add_rx(vid: str, b: RxIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can("bams", "therapist"))):
    """Safety check: 422 safety_block (allergy / pregnancy / stock); 201 with warning (diabetes)."""
    v = s.get(Visit, vid)
    if not v or v.status != "consult":
        raise ApiError(409, "bad_state", "Open the consultation first.")
    item, p = s.get(InventoryItem, b.itemId), s.get(Patient, v.patient_id)
    if not item or item.archived:
        raise not_found("Item")
    r = safety_check(item, b.qty, p)
    if "block" in r:
        audit(s, user.id, "rx.blocked", "visit", vid, {"item": item.id, "reason": r["block"]})
        s.commit()   # keep the audit entry
        raise ApiError(422, "safety_block", r["block"])
    row = RxItem(visit_id=vid, item_id=item.id, qty=b.qty, warning=r.get("warn"))
    s.add(row)
    s.flush()
    return {"id": row.id, "warning": r.get("warn")}


@router.delete("/visits/{vid}/rx/{rid}")
def del_rx(vid: str, rid: str, s: Session = Depends(get_session), _: CurrentUser = Depends(can("bams", "therapist"))):
    row = s.get(RxItem, rid)
    if row and row.visit_id == vid:
        s.delete(row)
    return {"ok": True}


@router.post("/visits/{vid}/complete")
def complete_visit(vid: str, bg: BackgroundTasks, s: Session = Depends(get_session), _: CurrentUser = Depends(can("bams", "therapist"))):
    """Consultation / therapy finished → pharmacy (if medicines) or billing. The invoice number is reserved now and the
    invoice is emailed to the patient (after this request, so a slow mail server never holds up the visit)."""
    v = s.get(Visit, vid)
    if not v:
        raise not_found("Visit")
    unit = s.get(Unit, v.unit_id)
    if unit.type == "consult" and not v.diagnosis:
        raise ApiError(422, "diagnosis_required", "Choose a diagnosis before completing.")
    n = len(s.exec(select(RxItem).where(RxItem.visit_id == vid)).all())
    to = "dispense" if n else "billing"
    move_visit(s, vid, to)
    if not v.bill_no:
        v.bill_no = f"INV-{today_my()[:4]}-{next_number(s, 'invoice'):05d}"
        s.add(v)
    s.commit()  # save first: the email task reads this data and SQLite allows one writer
    bg.add_task(emails.invoice_for_visit, vid)
    return {"status": to, "invoice": v.bill_no}


# --------------------------------------------------------------------------- pharmacy
def inventory_out(i: InventoryItem) -> dict:
    return {"id": i.id, "name": i.name, "form": i.form, "unit": i.unit, "stock": i.stock, "reorder": i.reorder_level, "price": i.price, "cost": i.cost,
            "batch": i.batch, "exp": i.expiry, "base": i.base_oil, "contra": i.contra or [], "sugar": i.has_sugar, "use": i.used_for, "archived": i.archived}


@router.get("/inventory")
def inventory(all: bool = False, s: Session = Depends(get_session), _: CurrentUser = Depends(current_user)):
    """Active products. ?all=true also returns deleted (archived) ones, which past records still refer to."""
    q = select(InventoryItem).order_by(InventoryItem.sort, InventoryItem.id)
    return [inventory_out(i) for i in s.exec(q) if all or not i.archived]


# ---- products: add / edit / delete / CSV import. Stock and cost changes post to the books (see app/products.py).
def _apply(i: InventoryItem, d: dict) -> None:
    i.name, i.form, i.unit, i.stock, i.reorder_level, i.price, i.cost = d["name"], d["form"], d["unit"], d["stock"], d["reorder"], d["price"], d["cost"]
    i.batch, i.expiry, i.base_oil, i.has_sugar, i.contra, i.used_for = d["batch"] or None, d["exp"] or None, d["base"], d["sugar"], d["contra"], d["use"]


def _others(s: Session) -> list:
    return [(i.id, i.name) for i in s.exec(select(InventoryItem).where(InventoryItem.archived == False))]  # noqa: E712


def _next_product_id(s: Session) -> str:
    nums = [int(i[1:]) for i in s.exec(select(InventoryItem.id)) if i[:1] == "m" and i[1:].isdigit()]
    return f"m{max(nums, default=0) + 1}"


def _book(s: Session, before: dict | None, after: dict | None, ref: str) -> None:
    for e in P.postings(before, after):
        post(s, e["d"], e["dr"], e["cr"], e["amt"], ref)


def _create(s: Session, d: dict, user: CurrentUser) -> InventoryItem:
    i = InventoryItem(id=_next_product_id(s), name=d["name"], form=d["form"], unit=d["unit"], stock=0, reorder_level=0, price=0,
                      sort=(max([x.sort for x in s.exec(select(InventoryItem))], default=0) + 1))
    _apply(i, d)
    s.add(i)
    s.flush()
    if d["stock"]:
        s.add(StockMove(item_id=i.id, qty=d["stock"], reason="opening", ref=i.id))
    _book(s, None, d, i.id)
    audit(s, user.id, "product.create", "inventory", i.id, {"name": d["name"], "stock": d["stock"]})
    return i


def _update(s: Session, i: InventoryItem, d: dict, user: CurrentUser, action: str = "product.update") -> None:
    before = inventory_out(i)
    if d["stock"] != i.stock:
        s.add(StockMove(item_id=i.id, qty=d["stock"] - i.stock, reason="adjust", ref=i.id))
    _book(s, before, d, i.id)
    _apply(i, d)
    s.add(i)
    audit(s, user.id, action, "inventory", i.id, {"before": {k: before[k] for k in ("name", "stock", "price", "cost")}, "after": {k: d[k] for k in ("name", "stock", "price", "cost")}})


class ProductIn(BaseModel):
    name: str = ""
    form: str = ""
    unit: str = ""
    stock: Any = 0                   # numbers or text from a CSV; checked in app/products.py
    reorder: Any = 0
    price: Any = None
    cost: Any = 0
    batch: Optional[str] = ""
    exp: Optional[str] = ""
    base: Optional[str] = ""
    sugar: bool = False
    contra: list[str] = []
    use: str = "both"


@router.post("/inventory", status_code=201)
def create_product(b: ProductIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can("bams"))):
    d = P.check_product(b.model_dump(), item_id=None, others=_others(s))
    return inventory_out(_create(s, d, user))


@router.put("/inventory/{item_id}")
def update_product(item_id: str, b: ProductIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can("bams"))):
    i = s.get(InventoryItem, item_id)
    if not i or i.archived:
        raise not_found("Product")
    d = P.check_product(b.model_dump(), item_id=item_id, others=_others(s))
    _update(s, i, d, user)
    return inventory_out(i)


@router.delete("/inventory/{item_id}")
def delete_product(item_id: str, s: Session = Depends(get_session), user: CurrentUser = Depends(can("bams"))):
    """Delete = archive. Past prescriptions/invoices keep the name; stock left is written off (Dr 5030, Cr 1200)."""
    i = s.get(InventoryItem, item_id)
    if not i or i.archived:
        raise not_found("Product")
    waiting = s.exec(select(RxItem).join(Visit, Visit.id == RxItem.visit_id).where(RxItem.item_id == item_id, Visit.status.in_(["consult", "dispense"]))).first()
    if waiting:
        raise ApiError(409, "in_use", f"{i.name} is on a prescription waiting to be dispensed. Dispense or remove it first.")
    _book(s, inventory_out(i), None, i.id)
    if i.stock:
        s.add(StockMove(item_id=i.id, qty=-i.stock, reason="delete", ref=i.id))
    i.stock, i.archived = 0, True
    s.add(i)
    audit(s, user.id, "product.delete", "inventory", i.id, {"name": i.name})
    return {"ok": True}


class ImportIn(BaseModel):
    rows: list[dict] = Field(min_length=1, max_length=2000)


@router.post("/inventory/import")
def import_products(b: ImportIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can("bams"))):
    """All-or-nothing: every row is checked first; any error → 400 with the row list and nothing is saved.
    Row with id → update that product; without id → matched by name, else added."""
    errors, plan, others, seen = [], [], _others(s), set()
    by_name = {n.strip().lower(): i for i, n in others}
    for k, raw in enumerate(b.rows):
        line = raw.get("line") or k + 2
        rid = raw.get("id") or by_name.get(re.sub(r"\s+", " ", str(raw.get("name") or "").strip()).lower())
        item = s.get(InventoryItem, rid) if rid else None
        if raw.get("id") and (not item or item.archived):
            errors.append({"row": line, "message": f"No product with id {raw['id']}. Leave id blank to add a new product."})
            continue
        try:
            d = P.check_product(raw, item_id=item.id if item else None, others=others)
        except ApiError as e:
            errors.append({"row": line, "message": e.message})
            continue
        key = item.id if item else d["name"].lower()
        if key in seen:
            errors.append({"row": line, "message": "This product appears more than once in the file"})
            continue
        seen.add(key)
        plan.append((item, d))
        if not item:
            others.append(("new", d["name"]))   # a later row with the same name is a duplicate
    if errors:
        raise ApiError(400, "invalid", f"{len(errors)} row(s) need fixing. Nothing was imported.", errors=errors)
    added = updated = 0
    for item, d in plan:
        if item:
            _update(s, item, d, user, "product.import")
            updated += 1
        else:
            _create(s, d, user)
            added += 1
    return {"added": added, "updated": updated}


@router.post("/visits/{vid}/dispense")
def dispense(vid: str, s: Session = Depends(get_session), _: CurrentUser = Depends(can("bams"))):
    v = s.get(Visit, vid)
    if not v:
        raise not_found("Visit")
    if not can_move(v.status, "billing") or v.status != "dispense":
        raise ApiError(409, "bad_state", f"Visit is {v.status}; nothing to dispense.")
    for r in s.exec(select(RxItem).where(RxItem.visit_id == vid)).all():
        item = s.get(InventoryItem, r.item_id)
        if item.stock < r.qty:
            raise ApiError(409, "out_of_stock", f"Not enough stock for {item.name}.")
        item.stock -= r.qty
        s.add(item)
        s.add(StockMove(item_id=item.id, qty=-r.qty, reason="dispense", ref=vid))
        post(s, f"Dispensed · {item.name} × {r.qty}", L.A["cogs"], L.A["inventory"], r.qty * item.cost, vid)   # cost of sales at cost
    move_visit(s, vid, "billing")
    return {"ok": True}


@router.post("/inventory/{item_id}/reorder")
def reorder(item_id: str, s: Session = Depends(get_session), _: CurrentUser = Depends(can("bams"))):
    i = s.get(InventoryItem, item_id)
    if not i:
        raise not_found("Item")
    return {"id": i.id, "suggestedQty": reorder_qty(i.stock, i.reorder_level), "note": "Raise the purchase order; record the delivery with POST /api/inventory/{id}/receive."}


class ReceiveIn(BaseModel):
    qty: int = Field(ge=1)
    cost: float = Field(ge=0)        # total cost of this delivery (RM)
    batch: Optional[str] = None
    expiry: Optional[str] = None


@router.post("/inventory/{item_id}/receive")
def receive(item_id: str, b: ReceiveIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can("bams"))):
    """Stock received on credit: Dr 1200 inventory, Cr 2000 supplier payable."""
    i = s.get(InventoryItem, item_id)
    if not i or i.archived:
        raise not_found("Item")
    i.stock += b.qty
    i.cost = L.r2(b.cost / b.qty)
    i.batch = b.batch or i.batch
    i.expiry = b.expiry or i.expiry
    s.add(i)
    s.add(StockMove(item_id=i.id, qty=b.qty, reason="receive", ref=f"PO-{item_id}"))
    post(s, f"Stock received · {i.name} × {b.qty}", L.A["inventory"], L.A["ap"], b.cost, f"PO-{item_id}")
    audit(s, user.id, "stock.receive", "inventory", item_id, {"qty": b.qty, "cost": b.cost})
    return {"ok": True}


# --------------------------------------------------------------------------- billing
def invoice_lines(s: Session, vid: str) -> tuple[Visit, list[dict]]:
    v = s.get(Visit, vid)
    if not v:
        raise not_found("Visit")
    unit = s.get(Unit, v.unit_id)
    lines: list[dict] = []
    if v.client_package_id:
        t = s.get(Service, v.package_service_id) if v.package_service_id else None
        lines.append({"d": f"Package session (prepaid) · {t.name['en']}" if t else "Package session (prepaid)", "q": 1, "p": 0, "kind": "pkg"})
    elif v.service_id:
        sv = s.get(Service, v.service_id)
        if sv:
            d = f"{sv.name['en']} (offer, normal RM{L._cell(sv.normal_price)})" if sv.normal_price else sv.name["en"]
            lines.append({"d": d, "q": 1, "p": sv.price, "kind": "tx" if unit.type == "therapy" else "cons"})
    for r in s.exec(select(RxItem).where(RxItem.visit_id == vid)):
        item = s.get(InventoryItem, r.item_id)
        lines.append({"d": item.name, "q": r.qty, "p": item.price, "kind": "med"})
    return v, lines


def _pt(p: Patient) -> dict:
    return {"citizenship": p.citizenship, "idType": p.id_type}


@router.get("/visits/{vid}/invoice-preview")
def invoice_preview(vid: str, s: Session = Depends(get_session), _: CurrentUser = Depends(current_user)):
    v, lines = invoice_lines(s, vid)
    return L.apply_tax(lines, _pt(s.get(Patient, v.patient_id)), sst_settings(s), today_my())


class PayIn(BaseModel):
    method: Literal["cash", "card", "duitnow", "transfer", "package"]
    extrasMethod: Method = "duitnow"


@router.post("/visits/{vid}/pay", status_code=201)
def pay(vid: str, b: PayIn, bg: BackgroundTasks, s: Session = Depends(get_session), user: CurrentUser = Depends(can("cashier"))):
    """cash/card/duitnow → paid now; transfer → PENDING (Dr 1100) until confirmed; package → one PAID session (Dr 2100 Cr 4030).
    SST per line from the patient's citizenship."""
    v, lines = invoice_lines(s, vid)
    if v.status != "billing":
        raise ApiError(409, "bad_state", "This visit is not ready for payment.")
    pt = s.get(Patient, v.patient_id)
    inv = L.apply_tax(lines, _pt(pt), sst_settings(s), today_my())
    inv_no = v.bill_no or f"INV-{today_my()[:4]}-{next_number(s, 'invoice'):05d}"      # reserved at completion (emailed invoice)

    def parts(kinds):
        out = []
        for k in kinds:
            ls = [x for x in inv["lines"] if x["kind"] == k]
            net = L.r2(sum(x["net"] for x in ls))
            if net > 0:
                out.append({"acc": L.income_acc(k), "net": net, "tax": L.r2(sum(x["tax"] for x in ls)), "taxCode": ls[0]["taxCode"]})
        return out

    code = next((x["taxCode"] for x in inv["lines"] if x["tax"] > 0), next((x["taxCode"] for x in inv["lines"] if x["net"] > 0), "NR"))
    status, tx_id = "paid", None
    if b.method == "package":
        if not v.client_package_id:
            raise ApiError(409, "no_package", "This visit is not a package session.")
        k = next(x for x in packages_for(s) if x["id"] == v.client_package_id)
        if k["expired"]:
            raise ApiError(409, "package_expired", f"This package expired on {k['expiresOn']}. Sessions can't be used after the validity period.")
        if not k["canUse"]:
            raise ApiError(409, "balance_due", f"No paid session left. Collect the balance (RM{k['balance']:.2f}) first.")
        svc = session_therapy(s, k, v.package_service_id)
        cp = s.get(ClientPackage, k["id"])
        cp.used += 1
        s.add(cp)
        s.add(PackageSession(client_package_id=cp.id, visit_id=vid, used_on=today_my(), service_id=svc))
        t = s.get(Service, svc) if svc else None
        post(s, f"{inv_no} · package session{' · ' + t.name['en'] if t else ''} ({pt.name})", L.A["deposits"], L.A["pkgIncome"], k["per"], inv_no)
        meds = parts(["med"])
        if meds:
            tx_id = money_in(s, user.id, d=f"{inv_no} · medicines", parts=meds, method=b.extrasMethod, ref=inv_no, pid=pt.id, tax_code=code).id
    else:
        status = "pending" if b.method == "transfer" else "paid"
        tx_id = money_in(s, user.id, d=f"{inv_no} · {pt.name}", parts=parts(["cons", "tx", "med"]), method=b.method, status=status, ref=inv_no, pid=pt.id, tax_code=code).id
    s.add(Invoice(id=inv_no, visit_id=vid, patient_id=pt.id, unit_id=v.unit_id, issued_on=today_my(), subtotal=inv["subtotal"], sst=inv["sst"], total=inv["total"],
                  method=b.method, status=status, lines=inv["lines"], tx_id=tx_id))
    move_visit(s, vid, "done")
    audit(s, user.id, "invoice.create", "invoice", inv_no, {"total": inv["total"], "sst": inv["sst"], "method": b.method})
    if status == "paid" and inv["total"] > 0:
        s.commit()  # save first: the email task reads this data and SQLite allows one writer
        bg.add_task(emails.receipt_for_invoice, inv_no)          # pending transfers: emailed when confirmed as paid
    return {"invoice": inv_no, "subtotal": inv["subtotal"], "sst": inv["sst"], "total": inv["total"], "status": status, "transaction": tx_id}


class EmailIn(BaseModel):
    kind: Literal["invoice", "receipt"]


@router.post("/invoices/{inv_no}/email")
def email_invoice(inv_no: str, b: EmailIn, s: Session = Depends(get_session), _: CurrentUser = Depends(can("cashier"))):
    """Send (again) the invoice or the receipt for a bill to the patient's email. Returns the delivery status."""
    i = s.get(Invoice, inv_no)
    if not i:
        raise not_found("Invoice")
    if b.kind == "receipt" and (i.status != "paid" or i.total <= 0):
        raise ApiError(409, "not_paid", "A receipt can only be sent for a paid bill.")
    res = emails.invoice_for_visit(i.visit_id) if b.kind == "invoice" else emails.receipt_for_invoice(inv_no)
    return res


@router.get("/emails")
def email_log(ref: Optional[str] = None, limit: int = 100, s: Session = Depends(get_session), _: CurrentUser = Depends(can("cashier"))):
    q = select(EmailLog).where(EmailLog.kind != "otp").order_by(EmailLog.id.desc()).limit(min(limit, 500))  # type: ignore[attr-defined]
    if ref:
        q = q.where(EmailLog.ref == ref)
    return [{"kind": x.kind, "to": x.to_email, "subject": x.subject, "ref": x.ref, "status": x.status, "error": x.error, "at": x.created_at.isoformat()} for x in s.exec(q)]


@router.get("/invoices")
def invoices(s: Session = Depends(get_session), _: CurrentUser = Depends(current_user)):
    rows = s.exec(select(Invoice, Patient.name).join(Patient, Patient.id == Invoice.patient_id).order_by(Invoice.issued_on.desc(), Invoice.id.desc()).limit(500))  # type: ignore[attr-defined]
    return [{**i.model_dump(), "patient_name": n} for i, n in rows]


# --------------------------------------------------------------------------- packages (full or partial payment)
@router.get("/client-packages")
def client_packages(patientId: str | None = None, s: Session = Depends(get_session), _: CurrentUser = Depends(current_user)):
    return packages_for(s, patientId)


class SellIn(BaseModel):
    patientId: str
    packageId: str
    plan: Literal["full", "partial"]
    amount: Optional[float] = Field(default=None, gt=0)
    method: Method


def _pkg_tax(s: Session, p: Patient, amount: float) -> tuple[str, float]:
    sst = sst_settings(s)
    code = L.tax_code_for("pkg", _pt(p), sst, today_my())
    return code, (L.r2(amount * float(sst["rate"]) / 100) if code == "SV6" else 0.0)


@router.post("/client-packages", status_code=201)
def sell_package(b: SellIn, bg: BackgroundTasks, s: Session = Depends(get_session), user: CurrentUser = Depends(can("cashier"))):
    g, p = s.get(Package, b.packageId), s.get(Patient, b.patientId)
    if not g or not g.active:
        raise not_found("Package")
    if not p:
        raise not_found("Patient")
    amt = g.price if b.plan == "full" else L.r2(b.amount or 0)
    err = check_payment(g.price, 0, amt, True)
    if err:
        raise ApiError(422, "payment_invalid", err)
    k = ClientPackage(patient_id=p.id, package_id=g.id, sessions=g.sessions, price=g.price, sold_on=today_my(), plan=b.plan, name=g.name, items=g.items or [], validity_months=g.validity_months)
    s.add(k)
    s.flush()
    s.add(PackagePayment(client_package_id=k.id, paid_on=today_my(), amount=amt, method=b.method, received_by=user.id))
    code, tax = _pkg_tax(s, p, amt)
    t = money_in(s, user.id, d=f"Package {'sale (paid in full)' if b.plan == 'full' else 'deposit'} · {g.name['en']} ({p.name})",
                 parts=[{"acc": L.A["deposits"], "net": amt, "tax": tax, "taxCode": code}], method=b.method, ref=k.id, pid=p.id, tax_code=code)
    audit(s, user.id, "package.sell", "client_package", k.id, {"plan": b.plan, "amount": amt})
    s.commit()  # save first: the email task reads this data and SQLite allows one writer
    bg.add_task(emails.receipt_for_package_payment, t.id)
    return {"id": k.id, "paid": amt, "sst": tax, "charged": t.amount, "balance": L.r2(g.price - amt), "transaction": t.id}


class PkgPayIn(BaseModel):
    amount: float = Field(gt=0)
    method: Method


@router.post("/client-packages/{kid}/payments", status_code=201)
def package_payment(kid: str, b: PkgPayIn, bg: BackgroundTasks, s: Session = Depends(get_session), user: CurrentUser = Depends(can("cashier"))):
    k = next((x for x in packages_for(s) if x["id"] == kid), None)
    if not k:
        raise not_found("Package")
    err = check_payment(k["price"], k["paid"], b.amount, False)
    if err:
        raise ApiError(422, "payment_invalid", err)
    s.add(PackagePayment(client_package_id=kid, paid_on=today_my(), amount=L.r2(b.amount), method=b.method, received_by=user.id))
    p, g = s.get(Patient, k["patient_id"]), s.get(Package, k["package_id"])
    code, tax = _pkg_tax(s, p, b.amount)
    t = money_in(s, user.id, d=f"Package balance · {(k['name'] or g.name)['en']} ({p.name})", parts=[{"acc": L.A["deposits"], "net": L.r2(b.amount), "tax": tax, "taxCode": code}],
             method=b.method, ref=kid, pid=p.id, tax_code=code)
    audit(s, user.id, "package.payment", "client_package", kid, {"amount": b.amount})
    s.commit()  # save first: the email task reads this data and SQLite allows one writer
    bg.add_task(emails.receipt_for_package_payment, t.id)
    return {"paid": L.r2(k["paid"] + b.amount), "balance": L.r2(k["balance"] - b.amount)}


class SessionIn(BaseModel):
    serviceId: Optional[str] = None     # which therapy of the package was done


@router.post("/client-packages/{kid}/sessions")
def package_session(kid: str, b: SessionIn | None = None, s: Session = Depends(get_session), _: CurrentUser = Depends(can("therapist", "cashier"))):
    k = next((x for x in packages_for(s) if x["id"] == kid), None)
    if not k:
        raise not_found("Package")
    if k["expired"]:
        raise ApiError(409, "package_expired", f"This package expired on {k['expiresOn']}. Sessions can't be used after the validity period.")
    if not k["canUse"]:
        done = k["left"] <= 0
        raise ApiError(409, "completed" if done else "balance_due", "All sessions used." if done else "No paid session left. Collect the balance to continue.")
    svc = session_therapy(s, k, b.serviceId if b else None)
    cp = s.get(ClientPackage, kid)
    cp.used += 1
    s.add(cp)
    s.add(PackageSession(client_package_id=kid, used_on=today_my(), service_id=svc))
    p, t = s.get(Patient, cp.patient_id), (s.get(Service, svc) if svc else None)
    post(s, f"Package session{' · ' + t.name['en'] if t else ''} · {p.name}", L.A["deposits"], L.A["pkgIncome"], k["per"], kid)
    return {"used": cp.used}


# --------------------------------------------------------------------------- dashboard & audit
@router.get("/dashboard")
def dashboard(days: int = 30, unit: str | None = None, s: Session = Depends(get_session), _: CurrentUser = Depends(current_user)):
    days = min(365, max(1, days))
    today = date.fromisoformat(today_my())
    start = (today - timedelta(days=days - 1)).isoformat()
    visits = [v for v in s.exec(select(Visit).where(Visit.visit_date >= start)) if v.status not in ("booked", "cancelled") and (not unit or v.unit_id == unit)]
    per_day = [{"day": (today - timedelta(days=days - 1 - i)).isoformat(), "visits": 0} for i in range(days)]
    idx = {d["day"]: d for d in per_day}
    for v in visits:
        if v.visit_date in idx:
            idx[v.visit_date]["visits"] += 1
    inv = sum(i.total for i in s.exec(select(Invoice).where(Invoice.issued_on >= start)) if not unit or i.unit_id == unit)
    pk = sum(p.amount for p in s.exec(select(PackagePayment).where(PackagePayment.paid_on >= start))) if (not unit or unit == "tx") else 0
    waits = [(v.started_at - v.checked_in_at).total_seconds() / 60 for v in visits if v.unit_id == "opd" and v.started_at and v.checked_in_at]
    sessions = len(s.exec(select(PackageSession).where(PackageSession.used_on >= start)).all())
    due = [k for k in packages_for(s) if k["balance"] > 0]
    soon = (today + timedelta(days=60)).isoformat()
    stock = [inventory_out(i) for i in s.exec(select(InventoryItem)) if not i.archived and (i.stock < i.reorder_level or (i.expiry and i.expiry < soon))]
    return {"perDay": per_day, "money_received": L.r2(inv + pk), "avg_wait_min": (sum(waits) / len(waits)) if waits else None, "package_sessions": sessions,
            "balances": {"clients": len(due), "amount": L.r2(sum(k["balance"] for k in due)), "overdue": len([k for k in due if k["overdue"]])}, "stock": stock}


@router.get("/audit")
def audit_log(s: Session = Depends(get_session), _: CurrentUser = Depends(can("admin"))):
    return [a.model_dump() for a in s.exec(select(AuditLog).order_by(AuditLog.id.desc()).limit(300))]  # type: ignore[attr-defined]


_ = (datetime, total)  # re-exported helpers kept for API parity
