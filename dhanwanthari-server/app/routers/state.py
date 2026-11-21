"""GET /api/state — everything the web app shows, in the shape of its local store (src/lib/store.jsx),
so every screen works unchanged in live mode. Fine for one clinic; add paging if the data grows very large."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from ..auth import CurrentUser, current_user
from ..db import get_session
from ..models import ClientPackage, EmailLog, InventoryItem, Invoice, Package, PackagePayment, PackageSession, Patient, RxItem, Service, Unit, Visit
from ..posting import journal_rows, sst_settings, tx_rows
from .catalog import package_out, service_out
from .clinic import inventory_out, patient_out

router = APIRouter(prefix="/api")


def _iso(dt) -> str | None:
    return dt.isoformat() if dt else None


@router.get("/state")
def state(s: Session = Depends(get_session), user: CurrentUser = Depends(current_user)):
    units = {u.id: u.type for u in s.exec(select(Unit))}
    P = [patient_out(p) for p in s.exec(select(Patient).order_by(Patient.created_at.desc()))]  # type: ignore[attr-defined]

    visits = s.exec(select(Visit).order_by(Visit.visit_date, Visit.slot)).all()
    items: dict[str, list[RxItem]] = {}
    for r in s.exec(select(RxItem)):
        items.setdefault(r.visit_id, []).append(r)
    inv_by_visit = {i.visit_id: i.id for i in s.exec(select(Invoice)) if i.visit_id}
    Q, rx = [], {}
    for v in visits:
        therapy = units.get(v.unit_id) == "therapy"
        Q.append({"id": v.id, "date": v.visit_date, "pid": v.patient_id, "unit": v.unit_id, "time": v.slot, "kind": v.kind, "status": v.status,
                  "checkedInAt": _iso(v.checked_in_at), "startedAt": _iso(v.started_at), "prac": v.practitioner_id, "room": v.room,
                  "svc": v.service_id if therapy else None, "pk": v.client_package_id, "pkSvc": v.package_service_id, "cleared": v.cleared_at is not None, "billNo": v.bill_no, "invoice": inv_by_visit.get(v.id)})
        its = items.get(v.id, [])
        if v.status in ("booked", "waiting") and not its and not v.diagnosis:
            continue
        rx[v.id] = {"items": [{"id": i.item_id, "q": i.qty, "warn": i.warning, "rid": i.id} for i in its], "dx": v.diagnosis or "", "dosha": v.dosha or "",
                    "note": v.notes or "", "mc": v.mc_days or 0, "svc": v.service_id or ("abhy" if therapy else "cons")}

    INV = [inventory_out(i) for i in s.exec(select(InventoryItem).order_by(InventoryItem.sort, InventoryItem.id))]

    pays: dict[str, list] = {}
    for p in s.exec(select(PackagePayment).order_by(PackagePayment.id)):
        pays.setdefault(p.client_package_id, []).append({"date": p.paid_on, "amt": p.amount, "method": p.method})
    sess: dict[str, list] = {}
    usage: dict[str, dict] = {}
    for x in s.exec(select(PackageSession).order_by(PackageSession.id)):
        sess.setdefault(x.client_package_id, []).append(x.used_on)
        if x.service_id:
            u = usage.setdefault(x.client_package_id, {})
            u[x.service_id] = u.get(x.service_id, 0) + 1
    # terms = the package as sold; later edits to the package only apply to new sales
    PK = [{"id": k.id, "pid": k.patient_id, "pkg": k.package_id, "used": k.used, "sold": k.sold_on, "plan": k.plan, "payments": pays.get(k.id, []), "log": sess.get(k.id, []),
           "usage": usage.get(k.id, {}), "terms": {"price": k.price, "sessions": k.sessions, "items": k.items or [], "validityMonths": k.validity_months, **({"name": k.name} if k.name else {})}}
          for k in s.exec(select(ClientPackage).order_by(ClientPackage.sold_on.desc(), ClientPackage.id))]  # type: ignore[attr-defined]
    SVC = [service_out(x) for x in s.exec(select(Service).where(Service.unit_type == "therapy").order_by(Service.id))]
    PKG = [package_out(g) for g in s.exec(select(Package).order_by(Package.price))]

    # latest email attempt per (ref, kind): shown on the Billing page
    mails: dict = {}
    for m in s.exec(select(EmailLog).where(EmailLog.kind != "otp").order_by(EmailLog.id)):
        mails[(m.ref, m.kind)] = {"status": m.status, "to": m.to_email, "error": m.error, "at": m.created_at.isoformat()}
    INVC = [{"id": i.id, "emails": {k: mails.get((i.id, k)) for k in ("invoice", "receipt")}, "date": i.issued_on, "vid": i.visit_id, "pid": i.patient_id, "unit": i.unit_id, "lines": i.lines, "subtotal": i.subtotal, "sst": i.sst,
             "total": i.total, "method": i.method, "status": i.status, "txId": i.tx_id} for i in s.exec(select(Invoice).order_by(Invoice.issued_on, Invoice.id))]

    J = list(reversed(journal_rows(s)))      # newest first, like the browser store
    return {"P": P, "Q": Q, "rx": rx, "INV": INV, "PK": PK, "SVC": SVC, "PKG": PKG, "INVC": INVC, "J": J, "TX": tx_rows(s), "SET": {"sst": sst_settings(s)},
            "user": {"id": user.id, "name": user.get("name"), "role": user.role}}
