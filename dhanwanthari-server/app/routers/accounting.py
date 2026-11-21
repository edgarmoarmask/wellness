"""Accounting endpoints: chart of accounts, SST settings, transactions (paid / pending / failed / cancelled), Add payment / expense,
opening balances, reports (P&L, balance sheet, trial balance, general ledger, SST-02) and Excel / CSV downloads."""
from __future__ import annotations

import io
import re
from typing import Literal, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Query
from fastapi.responses import Response
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from pydantic import BaseModel, Field, field_validator
from sqlmodel import Session, select

from .. import emails
from .. import ledger as L
from ..auth import CurrentUser, can, current_user
from ..db import get_session, now_utc, today_my
from ..errors import ApiError, not_found
from ..models import Account, ClientPackage, InventoryItem, Invoice, JournalEntry, MoneyTransaction, Package, PackagePayment, Patient
from ..posting import audit, journal_rows, money_in, money_out, post, settings_row, sst_settings, tx_rows
from .clinic import inventory_out

router = APIRouter(prefix="/api")
Method = Literal["cash", "card", "duitnow", "transfer"]


def _range(period: str | None, start: str | None, end: str | None) -> tuple[str, str]:
    if period:
        p = L.period(period)
        return p["from"], p["to"]
    return start or "1900-01-01", end or "2999-12-31"


@router.get("/accounts")
def accounts(s: Session = Depends(get_session), _: CurrentUser = Depends(current_user)):
    return [{"code": a.code, "name": a.name, "type": a.type, "group": a.grp} for a in s.exec(select(Account).where(Account.active == True).order_by(Account.code))]  # noqa: E712


# --------------------------------------------------------------------------- SST settings
class SSTIn(BaseModel):
    registered: bool
    regNo: str = Field(default="", max_length=40)
    rate: float = Field(default=6, ge=0, le=20)
    effectiveFrom: str = ""
    threshold: float = Field(default=1500000, gt=0)
    consultExempt: bool = True
    medicinesTaxable: bool = True


@router.get("/settings/sst")
def get_sst(s: Session = Depends(get_session), _: CurrentUser = Depends(current_user)):
    return sst_settings(s)


@router.put("/settings/sst")  # admin only
def put_sst(b: SSTIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can())):
    if b.registered and not b.regNo:
        raise ApiError(422, "regno_required", "Enter the SST registration number.")
    row = settings_row(s)
    row.sst = b.model_dump()
    row.updated_at = now_utc()
    s.add(row)
    audit(s, user.id, "settings.sst", "settings", "sst", b.model_dump())
    return b.model_dump()


# --------------------------------------------------------------------------- transactions
@router.get("/transactions")
def transactions(status: str | None = None, q: str = "", period: str | None = None, start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to"),
                 s: Session = Depends(get_session), _: CurrentUser = Depends(current_user)):
    a, z = _range(period, start, end)
    term = q.lower()
    rows = [t for t in tx_rows(s) if (not status or status == "all" or t["status"] == status) and a <= t["date"] <= z
            and (not term or any(term in str(t.get(k) or "").lower() for k in ("d", "no", "ref", "acc")))]
    paid_in = [t for t in rows if t["type"] == "in" and t["status"] == "paid"]
    paid_out = [t for t in rows if t["type"] == "out" and t["status"] == "paid"]
    return {"totals": {"received": L.r2(sum(t["amount"] for t in paid_in)), "expenses": L.r2(sum(t["amount"] for t in paid_out)),
                       "pending": L.r2(sum(t["amount"] for t in rows if t["status"] == "pending"))}, "rows": rows}


class PaymentIn(BaseModel):
    description: str = Field(min_length=2)
    kind: Literal["cons", "tx", "med", "other"]
    amount: float = Field(gt=0)
    method: Method
    status: Literal["paid", "pending"] = "paid"
    patientId: Optional[str] = None
    reference: Optional[str] = Field(default=None, max_length=60)


@router.post("/payments", status_code=201)
def add_payment(b: PaymentIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can("cashier"))):
    """Money in outside Billing (retail sale, other income). SST from the patient's citizenship."""
    pt = {"citizenship": "citizen"}
    if b.patientId:
        p = s.get(Patient, b.patientId)
        if not p:
            raise not_found("Patient")
        pt = {"citizenship": p.citizenship, "idType": p.id_type}
    sst = sst_settings(s)
    code = L.tax_code_for(b.kind, pt, sst, today_my())
    tax = L.r2(b.amount * float(sst["rate"]) / 100) if code == "SV6" else 0.0
    t = money_in(s, user.id, d=b.description, parts=[{"acc": L.income_acc(b.kind), "net": L.r2(b.amount), "tax": tax, "taxCode": code}], method=b.method,
                 status=b.status, ref=b.reference or "", pid=b.patientId, tax_code=code)
    audit(s, user.id, "payment.create", "transaction", t.id, {"amount": t.amount})
    return {"id": t.id, "net": t.net, "tax": t.tax, "amount": t.amount, "status": t.status}


_EXPENSE_CODES = {c["code"] for c in L.EXPENSE_CATEGORIES}


class ExpenseIn(BaseModel):
    code: str
    amount: float = Field(gt=0)
    method: Method
    status: Literal["paid", "pending"] = "paid"
    note: Optional[str] = Field(default=None, max_length=200)
    reference: Optional[str] = Field(default=None, max_length=60)

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        if v not in _EXPENSE_CODES:
            raise ValueError("Unknown expense account")
        return v


@router.post("/expenses", status_code=201)
def add_expense(b: ExpenseIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can("cashier"))):
    """6xxx expense, 2000 pay supplier bill, 3200 drawings. pending = bill received but not paid yet (Cr 2000 payable)."""
    name = L.acc(b.code)["name"]
    t = money_out(s, user.id, d=f"{name} · {b.note}" if b.note else name, code=b.code, amount=b.amount, method=b.method, status=b.status, ref=b.reference or "")
    audit(s, user.id, "expense.create", "transaction", t.id, {"amount": b.amount, "code": b.code})
    return {"id": t.id, "status": t.status}


class StatusIn(BaseModel):
    status: Literal["paid", "pending", "failed", "cancelled"]
    method: Optional[Method] = None


ALLOWED = {"pending": ["paid", "failed", "cancelled"], "failed": ["pending", "paid", "cancelled"], "paid": ["cancelled"], "cancelled": []}


@router.post("/transactions/{tid}/status")
def set_status(tid: str, b: StatusIn, bg: BackgroundTasks, s: Session = Depends(get_session), user: CurrentUser = Depends(can("cashier"))):
    """pending → paid | failed | cancelled · failed → pending | paid | cancelled · paid → cancelled (refund/void, postings reversed)."""
    t = s.get(MoneyTransaction, tid)
    if not t:
        raise not_found("Transaction")
    if b.status not in ALLOWED[t.status]:
        raise ApiError(409, "bad_state", f"A {t.status} transaction cannot become {b.status}.")
    m = b.method or t.method
    if t.type == "in":
        if b.status == "paid":
            post(s, f"{t.id} received · {t.description}", L.cash_acc(m), L.A["ar"], t.amount, t.id)
        if b.status == "cancelled":
            src = L.cash_acc(t.method) if t.status == "paid" else L.A["ar"]
            for p in t.parts or []:
                post(s, f"{t.id} cancelled · {t.description}", p["acc"], src, p["net"], t.id)
                post(s, f"{t.id} cancelled · SST", L.A["sst"], src, p["tax"], t.id)
        for inv in s.exec(select(Invoice).where(Invoice.tx_id == t.id)):
            inv.status = b.status
            s.add(inv)
    else:
        if b.status == "paid" and t.account_code != L.A["ap"]:
            post(s, f"{t.id} paid · {t.description}", L.A["ap"], L.cash_acc(m), t.amount, t.id)
        if b.status == "cancelled":
            post(s, f"{t.id} cancelled · {t.description}", L.cash_acc(t.method) if t.status == "paid" else L.A["ap"], t.account_code, t.amount, t.id)
    t.log = [*(t.log or []), {"at": now_utc().isoformat(), "from": t.status, "to": b.status, "by": user.id}]
    t.status, t.method = b.status, m
    s.add(t)
    audit(s, user.id, "transaction.status", "transaction", t.id, {"to": b.status})
    if b.status == "paid" and t.type == "in":            # e.g. bank transfer confirmed → email the receipt
        inv = s.exec(select(Invoice).where(Invoice.tx_id == t.id)).first()
        s.commit()  # save first: the email task reads this data and SQLite allows one writer
        bg.add_task(emails.receipt_for_invoice, inv.id) if inv else bg.add_task(emails.receipt_for_package_payment, t.id)
    return {"id": t.id, "status": b.status}


class OpeningIn(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    balances: dict[str, float]

    @field_validator("balances")
    @classmethod
    def _b(cls, v: dict[str, float]) -> dict[str, float]:
        out = {k: x for k, x in v.items() if x and x > 0}
        if not out or any(not re.fullmatch(r"\d{4}", k) for k in out):
            raise ValueError("Enter at least one amount against a 4-digit account code.")
        return out


@router.post("/opening-balances", status_code=201)
def opening(b: OpeningIn, s: Session = Depends(get_session), user: CurrentUser = Depends(can())):
    """Go-live balances, posted against 3000 Owner's capital. Once only."""
    if s.exec(select(JournalEntry).where(JournalEntry.ref == "OPENING")).first():
        raise ApiError(409, "already_set", "Opening balances were already posted. Ask your accountant to adjust with a journal entry.")
    for code, amt in b.balances.items():
        liab = L.acc(code)["type"] == "liability"
        post(s, f"Opening balance · {L.acc(code)['name']}", L.A["capital"] if liab else code, code if liab else L.A["capital"], amt, "OPENING", b.date)
    audit(s, user.id, "opening.post", "journal", "OPENING", b.model_dump())
    return {"ok": True}


@router.get("/journal")
def journal(s: Session = Depends(get_session), _: CurrentUser = Depends(can("cashier"))):
    return list(reversed(journal_rows(s)))[:1000]


# --------------------------------------------------------------------------- reports
@router.get("/reports/{name}")
def report(name: str, period: str | None = None, start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to"),
           account: str | None = None, n: int = 6, s: Session = Depends(get_session), _: CurrentUser = Depends(can("cashier"))):
    a, z = _range(period, start, end)
    if name == "profit-and-loss":
        return L.profit_and_loss(journal_rows(s), a, z)
    if name == "balance-sheet":
        return L.balance_sheet(journal_rows(s), z)
    if name == "trial-balance":
        return L.trial_balance(journal_rows(s), z)
    if name == "general-ledger":
        return L.general_ledger(journal_rows(s), a, z, account or None)
    if name == "sst-02":
        return L.sst_summary(tx_rows(s), a, z, sst_settings(s))
    if name == "sst-threshold":
        return L.sst_threshold(tx_rows(s), sst_settings(s))
    if name == "sst-periods":
        return L.sst_periods(n)
    if name == "filing-calendar":
        return L.FILING_CALENDAR
    raise not_found("Report")


# --------------------------------------------------------------------------- downloads
def pack_for(s: Session, a: str, z: str) -> list[dict]:
    names = {p.id: p.name for p in s.exec(select(Patient))}
    invoices = [{"id": i.id, "date": i.issued_on, "pid": i.patient_id, "method": i.method, "subtotal": i.subtotal, "sst": i.sst, "total": i.total, "status": i.status, "lines": i.lines}
                for i in s.exec(select(Invoice).order_by(Invoice.issued_on, Invoice.id))]
    packages = []
    for k in s.exec(select(ClientPackage).order_by(ClientPackage.sold_on)):
        paid = sum(p.amount for p in s.exec(select(PackagePayment).where(PackagePayment.client_package_id == k.id)))
        g = s.get(Package, k.package_id)
        packages.append({"sold": k.sold_on, "patient": names.get(k.patient_id, ""), "pkg": g.name["en"], "price": k.price, "paid": L.r2(paid),
                         "balance": L.r2(max(0, k.price - paid)), "used": k.used, "sessions": k.sessions, "unearned": L.r2(max(0, paid - k.used * k.price / k.sessions))})
    inventory = [inventory_out(i) for i in s.exec(select(InventoryItem).order_by(InventoryItem.name)) if not i.archived]
    clinic = settings_row(s).clinic.get("name", "")
    return L.accountant_pack(journal=journal_rows(s), transactions=tx_rows(s), invoices=invoices, packages=packages, inventory=inventory,
                             patients=[{"id": k, "name": v} for k, v in names.items()], sst=sst_settings(s), start=a, end=z, clinic=clinic)


def xlsx_bytes(sheets: list[dict]) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    head = PatternFill("solid", fgColor="1F5C3A")
    for sh in sheets:
        ws = wb.create_sheet(sh["name"][:31])
        ws.append([c[1] for c in sh["columns"]])
        for r in sh["rows"]:
            ws.append([("" if r.get(c[0]) is None else r.get(c[0])) if not isinstance(r.get(c[0]), (list, dict)) else str(r.get(c[0])) for c in sh["columns"]])
        for cell in ws[1]:
            cell.font, cell.fill = Font(bold=True, color="FFFFFF"), head
        for i, (key, title) in enumerate(sh["columns"], 1):
            width = max([len(title) + 2] + [len(str(r.get(key) or "")) + 2 for r in sh["rows"][:300]])
            ws.column_dimensions[get_column_letter(i)].width = min(48, max(10, width))
            if "(RM)" in title:
                for row in ws.iter_rows(min_row=2, min_col=i, max_col=i):
                    row[0].number_format = '#,##0.00;(#,##0.00);"-"'
        ws.freeze_panes = "A2"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _slug(n: str) -> str:
    return re.sub(r"(^-|-$)", "", re.sub(r"[^a-z0-9]+", "-", n.lower()))


@router.get("/exports/{file}")
def export(file: str, period: str | None = None, start: str | None = Query(None, alias="from"), end: str | None = Query(None, alias="to"),
           s: Session = Depends(get_session), user: CurrentUser = Depends(can("cashier"))):
    """/api/exports/accountant-pack.xlsx (all reports) · /api/exports/<report>.csv|.xlsx (e.g. general-ledger.csv, sst-02-summary.xlsx)."""
    m = re.fullmatch(r"(.+)\.(csv|xlsx)", file)
    if not m:
        raise ApiError(400, "bad_file", "Use .csv or .xlsx")
    a, z = _range(period, start, end)
    sheets = pack_for(s, a, z)
    pick = sheets if m[1] == "accountant-pack" else [x for x in sheets if _slug(x["name"]) == m[1]]
    if not pick:
        raise ApiError(404, "not_found", "Unknown export. Try: accountant-pack, " + ", ".join(_slug(x["name"]) for x in sheets))
    audit(s, user.id, "export", "report", file, {"from": a, "to": z})
    name = f"{m[1]}_{a}_{z}.{m[2]}".replace("1900-01-01_2999-12-31", "all-time")
    disp = {"content-disposition": f'attachment; filename="{name}"'}
    if m[2] == "csv":
        if len(pick) > 1:
            raise ApiError(400, "csv_single", "CSV is one report at a time; use .xlsx for the full pack.")
        return Response(L.to_csv(pick[0]["rows"], pick[0]["columns"]), media_type="text/csv; charset=utf-8", headers=disp)
    return Response(xlsx_bytes(pick), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=disp)
