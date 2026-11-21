"""Patient and staff emails: sign-in code, invoice (visit finished), receipt (payment received).
HTML built with tables and inline styles (works in Gmail / Outlook / phone mail apps), logo + wordmark attached inline.
Patient emails run after the request has finished (FastAPI BackgroundTasks) and are recorded in email_log."""
from __future__ import annotations

import html as H
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlmodel import Session, select

from . import mailer
from .config import settings
from .db import engine, now_utc

log = logging.getLogger("dvc.mail")
ASSETS = Path(__file__).resolve().parent / "email_assets"
CLINIC = {
    "name": "Dhanwanthari Vilasam",
    "address": "No.241, 1st Floor, Jalan Tun Sambanthan, Brickfields, Kualalumpur-50470, Malaysia.",
    "email": "ayurvedabrickfieldskl@gmail.com",
    "phone": "+60 11 3342 3455",
    "specialities": "Spinal Disorders, Joint Disorders, Neck, Upper and Lower, Back Pain Management, Stroke Rehabilitation",
}
METHOD = {"cash": "Cash", "card": "Card", "duitnow": "DuitNow QR", "transfer": "Bank transfer", "package": "Prepaid package"}

# ---------------------------------------------------------------- amount in words (same as the app's bill.js)
_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
         "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _w999(n: int) -> str:
    h, r, out = n // 100, n % 100, []
    if h:
        out.append(_ONES[h] + " Hundred")
    if r:
        out.append(_ONES[r] if r < 20 else _TENS[r // 10] + ("-" + _ONES[r % 10] if r % 10 else ""))
    return " ".join(out)


def _words(n: int) -> str:
    if n == 0:
        return "Zero"
    parts = []
    for v, name in ((10**9, "Billion"), (10**6, "Million"), (1000, "Thousand"), (1, "")):
        q = (n // v) % 1000
        if q:
            parts.append(_w999(q) + (" " + name if name else ""))
    return " ".join(parts)


def amount_in_words(amount: float) -> str:
    cents = round(float(amount) * 100)
    rm, sen = cents // 100, cents % 100
    if rm == 0 and sen:
        return f"{_words(sen)} Sen Only"
    return f"{_words(rm)}{f' and {_words(sen)} Sen' if sen else ''} Only"


# ---------------------------------------------------------------- templates
e = H.escape
money = lambda n: f"{float(n or 0):,.2f}"   # noqa: E731
dmy = lambda d: f"{d[8:10]}/{d[5:7]}/{d[0:4]}"  # noqa: E731


def _images() -> dict:
    return {"dvlogo": ((ASSETS / "logo-email.jpg").read_bytes(), "image/jpeg"), "dvwordmark": ((ASSETS / "wordmark-email.png").read_bytes(), "image/png")}


def _shell(title: str, inner: str) -> str:
    return f"""<!DOCTYPE html><html><body style="margin:0;padding:0;background:#eef0ec;font-family:Arial,Helvetica,sans-serif;color:#2b2f2c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef0ec"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:#f2f1d6;padding:18px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="middle" width="64"><img src="cid:dvlogo" width="58" height="58" alt="" style="display:block;border-radius:50%"></td>
<td valign="middle" style="padding-left:10px"><img src="cid:dvwordmark" height="40" alt="Dhanwanthari Vilasam" style="display:block;height:40px"></td>
<td valign="middle" align="right" style="font-size:11px;line-height:16px;color:#55635a">{e(CLINIC['address'])}<br>{e(CLINIC['email'])}<br>{e(CLINIC['phone'])}</td>
</tr></table></td></tr>
<tr><td align="center" style="padding:26px 22px 6px;font-size:22px;font-weight:bold;letter-spacing:1px;color:#3a3f3c">{e(title)}</td></tr>
{inner}
<tr><td style="padding:14px 22px 20px;border-top:1px solid #dcdfd7;font-size:11px;color:#6b726d"><b style="color:#5d9a5a">We Specialize in:</b> {e(CLINIC['specialities'])}</td></tr>
</table><p style="font-size:11px;color:#8a908b;margin:12px 0 0">This email was sent by {e(CLINIC['name'])} about your visit. Please don't reply with medical questions; call or WhatsApp {e(CLINIC['phone'])}.</p>
</td></tr></table></body></html>"""


def _meta(rows: list[tuple[str, str]]) -> str:
    cells = "".join(f'<tr><td style="padding:3px 0;font-weight:bold;width:150px;color:#3a3f3c">{e(k)}</td><td style="padding:3px 0">{e(v)}</td></tr>' for k, v in rows)
    return f'<tr><td style="padding:12px 22px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">{cells}</table></td></tr>'


def _lines(lines: list[dict], d: dict, total_label: str) -> str:
    rows = "".join(f'<tr><td style="padding:10px 12px;border-bottom:1px solid #e2e4dd">{e(l["d"])}{f"<br><span style=\'font-size:12px;color:#7b827d\'>{e(l["note"])}</span>" if l.get("note") else ""}</td>'
                   f'<td align="right" style="padding:10px 12px;border-bottom:1px solid #e2e4dd;white-space:nowrap">{money(l["amt"])}</td></tr>' for l in lines)
    if d.get("sst"):
        rows += (f'<tr><td style="padding:6px 12px;color:#59605b">Subtotal</td><td align="right" style="padding:6px 12px;color:#59605b">{money(d["subtotal"])}</td></tr>'
                 f'<tr><td style="padding:6px 12px;color:#59605b">Service tax (SST) {e(str(d.get("sstRate", 6)))}%{" · SST reg. " + e(d["sstReg"]) if d.get("sstReg") else ""}</td>'
                 f'<td align="right" style="padding:6px 12px;color:#59605b">{money(d["sst"])}</td></tr>')
    rows += f'<tr><td style="padding:14px 12px 4px;font-size:16px;font-weight:bold">{e(total_label)}</td><td align="right" style="padding:14px 12px 4px;font-size:16px;font-weight:bold;white-space:nowrap">RM {money(d["total"])}</td></tr>'
    return (f'<tr><td style="padding:12px 22px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse">'
            f'<tr><td style="background:#f1f0e4;padding:10px 12px;font-size:12px;font-weight:bold;letter-spacing:.3px">DESCRIPTION</td><td align="right" style="background:#f1f0e4;padding:10px 12px;font-size:12px;font-weight:bold">AMOUNT (RM)</td></tr>'
            f'{rows}</table></td></tr>'
            f'<tr><td style="padding:4px 22px 0;font-size:13px;font-style:italic;color:#4b514d">Ringgit Malaysia: {e(amount_in_words(d["total"]))}</td></tr>')


def _text_lines(lines, d, total_label):
    out = [f"- {l['d']}: RM {money(l['amt'])}" for l in lines]
    if d.get("sst"):
        out += [f"Subtotal: RM {money(d['subtotal'])}", f"Service tax (SST): RM {money(d['sst'])}"]
    return "\n".join(out + [f"{total_label}: RM {money(d['total'])}", f"Ringgit Malaysia: {amount_in_words(d['total'])}"])


def otp_email(code: str, name: str) -> tuple[str, str, str]:
    inner = (f'<tr><td style="padding:10px 22px;font-size:14px;line-height:21px">Hello {e(name)},<br>Use this code to finish signing in to the clinic system. It expires in 5 minutes.</td></tr>'
             f'<tr><td align="center" style="padding:10px 22px 18px"><span style="display:inline-block;font-size:30px;letter-spacing:8px;font-weight:bold;background:#f2f1d6;border-radius:8px;padding:12px 22px;color:#234a3a">{e(code)}</span></td></tr>'
             f'<tr><td style="padding:0 22px 18px;font-size:12px;color:#6b726d">If you didn\'t try to sign in, ignore this email and tell the clinic admin.</td></tr>')
    return (f"{code} is your {CLINIC['name']} sign-in code", _shell("SIGN-IN CODE", inner),
            f"Hello {name},\n\nYour sign-in code is {code}. It expires in 5 minutes.\nIf you didn't try to sign in, ignore this email and tell the clinic admin.")


def invoice_email(d: dict) -> tuple[str, str, str]:
    meta = [("Invoice No:", d["no"]), ("Date:", dmy(d["date"])), ("Patient Name:", d["patient"])] + ([("Age:", f"{d['age']} years")] if d.get("age") is not None else [])
    inner = (_meta(meta) + _lines(d["lines"], d, "AMOUNT DUE") +
             f'<tr><td style="padding:14px 22px 18px;font-size:13px;color:#4b514d">Thank you for visiting us. Please pay at the counter (cash, card or DuitNow QR). Your official receipt will be emailed after payment.</td></tr>')
    text = (f"Invoice {d['no']} · {dmy(d['date'])}\nPatient: {d['patient']}\n\n{_text_lines(d['lines'], d, 'Amount due')}\n\n"
            f"Please pay at the counter (cash, card or DuitNow QR). Your official receipt will be emailed after payment.\n\n{CLINIC['name']} · {CLINIC['phone']}")
    return (f"Invoice {d['no']} · {CLINIC['name']}", _shell("INVOICE", inner), text)


def receipt_email(d: dict) -> tuple[str, str, str]:
    meta = [("Receipt No:", d["no"]), ("Date & time:", f"{dmy(d['date'])}{', ' + d['time'] if d.get('time') else ''}"), ("Received from:", d["patient"])]
    meta += ([("For:", d["billNo"])] if d.get("billNo") else []) + [("Payment method:", d["method"])]
    extra = ""
    if d.get("balance") is not None:
        extra = f'<tr><td style="padding:6px 22px 0;font-size:13px;color:#4b514d">Paid to date RM {money(d["paid"])} · Balance RM {money(d["balance"])}</td></tr>'
    inner = (_meta(meta) + _lines(d["lines"], d, "AMOUNT RECEIVED") + extra +
             '<tr><td style="padding:14px 22px 18px"><span style="display:inline-block;border:2px solid #3f8f4a;color:#3f8f4a;border-radius:6px;padding:5px 12px;font-weight:bold;font-size:13px;letter-spacing:.6px">PAID · THANK YOU</span></td></tr>')
    text = (f"Official receipt {d['no']} · {dmy(d['date'])}{' ' + d['time'] if d.get('time') else ''}\nReceived from: {d['patient']}\n"
            f"{'For: ' + d['billNo'] + chr(10) if d.get('billNo') else ''}Payment method: {d['method']}\n\n{_text_lines(d['lines'], d, 'Amount received')}\n\nPaid · thank you.\n{CLINIC['name']} · {CLINIC['phone']}")
    return (f"Receipt {d['no']} · {CLINIC['name']}", _shell("OFFICIAL RECEIPT", inner), text)


# ---------------------------------------------------------------- send + log
def record(s: Session, kind: str, to: str | None, subject: str, ref: str, res: dict) -> None:
    from .models import EmailLog
    s.add(EmailLog(kind=kind, to_email=to or "", subject=subject, ref=ref, status=res["status"], error=res.get("error"), message_id=res.get("messageId")))


def send_otp(s: Session, email: str, name: str, code: str) -> dict:
    """Synchronous (the person is waiting); logged in the caller's session (SQLite allows one writer at a time).
    In development the code is also printed on the server console."""
    if not settings.production:
        log.warning("[otp] %s → %s", email, code)
    subject, html, text = otp_email(code, name)
    res = mailer.send(email, subject, html, text, _images(), console_note="(sign-in code printed above)" if not settings.production else "")
    record(s, "otp", email, "Sign-in code", "", res)      # subject holds the code, so it isn't stored
    return res


def _patient_to(s, pid):
    from .models import Patient
    p = s.get(Patient, pid)
    return p, (p.email or "").strip() if p else ""


def _deliver(s: Session, kind: str, ref: str, pid: str, build) -> dict:
    p, to = _patient_to(s, pid)
    if not to:
        res = {"status": "skipped", "error": "No email address on the patient record"}
        record(s, kind, "", f"{kind} {ref}", ref, res)
        return res
    subject, html, text = build(p)
    res = mailer.send(to, subject, html, text, _images())
    record(s, kind, to, subject, ref, res)
    return res


def _age(dob, on):
    if not dob:
        return None
    b, n = datetime.fromisoformat(str(dob)[:10]).date(), datetime.fromisoformat(on[:10]).date()
    return n.year - b.year - ((n.month, n.day) < (b.month, b.day))


def _local_time(dt) -> str:
    if not dt:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (dt + timedelta(hours=settings.tz_offset_hours)).strftime("%I:%M %p").lstrip("0").lower()


def _invoice_lines(inv_lines):
    return [{"d": f"{l['d']} × {l['q']}" if l.get("q", 1) > 1 else l["d"], "note": f"RM {l['p']:.2f} each" if l.get("q", 1) > 1 else "",
             "amt": round(l.get("q", 1) * l.get("p", 0), 2)} for l in inv_lines]


def invoice_for_visit(visit_id: str) -> dict:
    """Background task: visit finished → email the invoice (amount due). Skipped when nothing is due (prepaid package session)."""
    from . import ledger as L
    from .models import Visit
    from .posting import sst_settings
    from .routers.clinic import _pt, invoice_lines
    with Session(engine) as s:
        v = s.get(Visit, visit_id)
        if not v or not settings.invoice_emails:
            return {"status": "skipped"}
        _, lines = invoice_lines(s, visit_id)
        from .models import Patient
        pt = s.get(Patient, v.patient_id)
        sst = sst_settings(s)
        inv = L.apply_tax(lines, _pt(pt), sst, v.visit_date)
        if inv["total"] <= 0:
            res = {"status": "skipped", "error": "Nothing to pay (prepaid package session)"}
            record(s, "invoice", pt.email or "", f"invoice {v.bill_no}", v.bill_no or visit_id, res)
            s.commit()
            return res
        d = {"no": v.bill_no, "date": v.visit_date, "patient": pt.name, "age": _age(pt.dob, v.visit_date), "lines": _invoice_lines(inv["lines"]),
             "subtotal": inv["subtotal"], "sst": inv["sst"], "sstRate": sst.get("rate", 6), "sstReg": sst.get("regNo"), "total": inv["total"]}
        res = _deliver(s, "invoice", v.bill_no or visit_id, pt.id, lambda p: invoice_email(d))
        s.commit()
        return res


def receipt_for_invoice(invoice_no: str) -> dict:
    """Background task: visit paid (cash, card, DuitNow, confirmed transfer, or medicines on a package visit) → email the receipt."""
    from .models import Invoice, MoneyTransaction, Patient
    from .posting import sst_settings
    with Session(engine) as s:
        i = s.get(Invoice, invoice_no)
        if not i or i.total <= 0 or i.status != "paid":
            return {"status": "skipped"}
        t = s.get(MoneyTransaction, i.tx_id) if i.tx_id else None
        pt, sst = s.get(Patient, i.patient_id), sst_settings(s)
        method = METHOD.get(i.method, i.method) if i.method != "package" else f"Prepaid package{' + ' + METHOD.get(t.method, t.method) + ' for medicines' if t else ''}"
        d = {"no": t.id if t else i.id, "billNo": i.id, "date": t.tx_date if t else i.issued_on, "time": _local_time(t.created_at if t else None),
             "patient": pt.name, "method": method, "lines": _invoice_lines(i.lines), "subtotal": i.subtotal, "sst": i.sst, "sstRate": sst.get("rate", 6),
             "sstReg": sst.get("regNo"), "total": i.total}
        res = _deliver(s, "receipt", i.id, pt.id, lambda p: receipt_email(d))
        s.commit()
        return res


def receipt_for_package_payment(tx_id: str) -> dict:
    """Background task: package sale / balance paid → email the receipt for that payment."""
    from .models import ClientPackage, MoneyTransaction, Patient
    from .routers.clinic import packages_for
    with Session(engine) as s:
        t = s.get(MoneyTransaction, tx_id)
        if not t or t.status != "paid" or t.type != "in":
            return {"status": "skipped"}
        cp = s.get(ClientPackage, t.reference) if t.reference else None
        if not cp:
            return {"status": "skipped"}
        k = next((x for x in packages_for(s, cp.patient_id) if x["id"] == cp.id), None)
        pt, name = s.get(Patient, cp.patient_id), (cp.name or {}).get("en", "Package")
        d = {"no": t.id, "billNo": name, "date": t.tx_date, "time": _local_time(t.created_at), "patient": pt.name, "method": METHOD.get(t.method, t.method),
             "lines": [{"d": t.description, "note": f"{cp.sessions} sessions" + (f" · valid until {dmy(k['expiresOn'])}" if k and k.get("expiresOn") else ""), "amt": t.net}],
             "subtotal": t.net, "sst": t.tax, "total": t.amount, "paid": k["paid"] if k else None, "balance": k["balance"] if k else None}
        res = _deliver(s, "receipt", t.id, pt.id, lambda p: receipt_email(d))
        s.commit()
        return res
