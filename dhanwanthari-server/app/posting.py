"""Double-entry posting helpers used by every money action. Same rules as the web app's store (see docs/ACCOUNTING.md)."""
from __future__ import annotations

from datetime import timezone

from sqlmodel import Session, select

from . import ledger as L
from .db import next_number, today_my
from .models import AuditLog, ClinicSettings, JournalEntry, MoneyTransaction


def post(s: Session, description: str, debit: str, credit: str, amount: float, ref: str | None = None, on: str | None = None) -> None:
    """One journal entry: Dr `debit`, Cr `credit` (account codes). Zero amounts are skipped."""
    if amount is None or amount <= 0.004:
        return
    s.add(JournalEntry(entry_date=on or today_my(), description=description, debit=debit, credit=credit, amount=L.r2(amount), ref=ref))


def audit(s: Session, actor: str | None, action: str, entity: str, entity_id: str, detail: dict | None = None) -> None:
    s.add(AuditLog(actor=actor, action=action, entity=entity, entity_id=entity_id, detail=detail or {}))


def settings_row(s: Session) -> ClinicSettings:
    row = s.get(ClinicSettings, 1)
    if not row:
        row = ClinicSettings(id=1, clinic={}, sst=dict(L.DEFAULT_SST))
        s.add(row)
        s.flush()
    return row


def sst_settings(s: Session) -> dict:
    return {**L.DEFAULT_SST, **(settings_row(s).sst or {})}


def _seq(s: Session) -> int:
    return next_number(s, "tx_seq")


def money_in(s: Session, actor: str | None, *, d: str, parts: list[dict], method: str, status: str = "paid", ref: str = "", pid: str | None = None, tax_code: str = "NR") -> MoneyTransaction:
    """Money in. paid → Dr cash/bank/clearing; pending → Dr 1100 receivable. Cr income/deposit; SST → 2200."""
    no = f"RC-{next_number(s, 'receipt'):05d}"
    debit = L.cash_acc(method) if status == "paid" else L.A["ar"]
    for p in parts:
        post(s, d, debit, p["acc"], p["net"], ref or no)
        post(s, f"{d} · SST", debit, L.A["sst"], p["tax"], ref or no)
    net, tax = L.r2(sum(p["net"] for p in parts)), L.r2(sum(p["tax"] for p in parts))
    main = sorted(parts, key=lambda p: -p["net"])[0]["acc"] if parts else L.A["other"]
    t = MoneyTransaction(id=no, tx_date=today_my(), type="in", description=d, account_code=main, method=method, reference=ref, patient_id=pid,
                         status=status, net=net, tax=tax, tax_code=tax_code, amount=L.r2(net + tax), parts=parts, log=[], created_by=actor, seq=_seq(s))
    s.add(t)
    s.flush()
    return t


def money_out(s: Session, actor: str | None, *, d: str, code: str, amount: float, method: str, status: str = "paid", ref: str = "") -> MoneyTransaction:
    """Money out. paid → Cr cash/bank; pending (bill received, unpaid) → Cr 2000 payable. Code 2000 = paying a supplier bill."""
    no = f"PV-{next_number(s, 'payment'):05d}"
    if code == L.A["ap"]:
        post(s, d, L.A["ap"], L.cash_acc(method), amount, no)
    else:
        post(s, d, code, L.cash_acc(method) if status == "paid" else L.A["ap"], amount, no)
    t = MoneyTransaction(id=no, tx_date=today_my(), type="out", description=d, account_code=code, method=method, reference=ref, status=status,
                         net=L.r2(amount), tax=0, tax_code="", amount=L.r2(amount), parts=[], log=[], created_by=actor, seq=_seq(s))
    s.add(t)
    s.flush()
    return t


def journal_rows(s: Session) -> list[dict]:
    return [{"id": f"J{e.id:06d}", "date": e.entry_date, "ref": e.ref or "", "d": e.description, "dr": e.debit, "cr": e.credit, "amt": e.amount}
            for e in s.exec(select(JournalEntry).order_by(JournalEntry.entry_date, JournalEntry.id))]


def tx_row(t: MoneyTransaction) -> dict:
    return {"id": t.id, "no": t.id, "date": t.tx_date, "type": t.type, "d": t.description, "acc": t.account_code, "method": t.method, "ref": t.reference,
            "pid": t.patient_id, "status": t.status, "net": t.net, "tax": t.tax, "taxCode": t.tax_code, "amount": t.amount, "parts": t.parts, "log": t.log,
            "at": (t.created_at.replace(tzinfo=timezone.utc) if t.created_at and t.created_at.tzinfo is None else t.created_at).isoformat() if t.created_at else None}


def tx_rows(s: Session) -> list[dict]:
    return [tx_row(t) for t in s.exec(select(MoneyTransaction).order_by(MoneyTransaction.seq.desc()))]  # type: ignore[attr-defined]
