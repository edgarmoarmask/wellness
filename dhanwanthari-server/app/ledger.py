"""Accounting core — chart of accounts, Malaysian service tax (SST), reports and the accountant pack.

Python port of the web app's ``src/lib/ledger.js``. Keep the two in step: same account codes, tax codes,
rounding and JSON keys, so the screens (which also compute reports in the browser) and the downloads agree.

Journal entry:   {"id", "date": "YYYY-MM-DD", "ref", "d", "dr": code, "cr": code, "amt"}
Transaction:     {"id", "no", "date", "type": "in"|"out", "d", "acc", "method", "ref", "pid",
                  "status": "paid"|"pending"|"failed"|"cancelled", "net", "tax", "taxCode", "amount", "parts"}
"""
from __future__ import annotations

import calendar
import math
from datetime import date, timedelta

# --------------------------------------------------------------------------- rounding (same as JS)
EPS = 2.220446049250313e-16


def r2(n: float) -> float:
    """JS: Math.round((n + Number.EPSILON) * 100) / 100  (round half up towards +infinity)."""
    return math.floor((n + EPS) * 100 + 0.5) / 100


def js_round1(x: float) -> float:
    """JS: Math.round(x * 1000) / 10 for percentages to one decimal."""
    return math.floor(x * 1000 + 0.5) / 10


# --------------------------------------------------------------------------- chart of accounts
_COA = [
    ("1000", "Cash in hand", "asset", "Current assets"),
    ("1010", "Bank – current account", "asset", "Current assets"),
    ("1020", "Card terminal clearing", "asset", "Current assets"),
    ("1030", "DuitNow QR clearing", "asset", "Current assets"),
    ("1100", "Accounts receivable – patients", "asset", "Current assets"),
    ("1200", "Inventory – medicines & oils", "asset", "Current assets"),
    ("1500", "Clinic equipment", "asset", "Non-current assets"),
    ("2000", "Accounts payable – suppliers", "liability", "Current liabilities"),
    ("2100", "Package deposits (unearned revenue)", "liability", "Current liabilities"),
    ("2200", "SST payable (service tax)", "liability", "Current liabilities"),
    ("2300", "EPF / SOCSO / EIS / PCB payable", "liability", "Current liabilities"),
    ("3000", "Owner's capital", "equity", "Equity"),
    ("3100", "Retained earnings", "equity", "Equity"),
    ("3200", "Owner's drawings", "equity", "Equity"),
    ("4010", "Consultation fees", "income", "Revenue"),
    ("4020", "Treatment & therapy revenue", "income", "Revenue"),
    ("4030", "Package revenue (sessions delivered)", "income", "Revenue"),
    ("4040", "Medicine & product sales", "income", "Revenue"),
    ("4090", "Other income", "income", "Revenue"),
    ("5010", "Cost of medicines sold", "cogs", "Cost of sales"),
    ("5020", "Therapy oils & consumables used", "cogs", "Cost of sales"),
    ("5030", "Stock adjustments & write-offs", "cogs", "Cost of sales"),
    ("6010", "Staff salaries & wages", "expense", "Operating expenses"),
    ("6020", "EPF, SOCSO & EIS (employer)", "expense", "Operating expenses"),
    ("6030", "Rent", "expense", "Operating expenses"),
    ("6040", "Utilities (electricity, water, internet)", "expense", "Operating expenses"),
    ("6050", "Marketing & advertising", "expense", "Operating expenses"),
    ("6060", "Card & payment gateway fees", "expense", "Operating expenses"),
    ("6070", "Repairs & maintenance", "expense", "Operating expenses"),
    ("6080", "Professional fees (accounting, audit, legal)", "expense", "Operating expenses"),
    ("6090", "Licences, permits & registration", "expense", "Operating expenses"),
    ("6100", "Laundry & linen", "expense", "Operating expenses"),
    ("6900", "Other expenses", "expense", "Operating expenses"),
]
COA = [{"code": c, "name": n, "type": t, "group": g} for c, n, t, g in _COA]
_BY_CODE = {a["code"]: a for a in COA}
DEBIT_NORMAL = {"asset", "cogs", "expense"}


def acc(code: str) -> dict:
    return _BY_CODE.get(code, {"code": code, "name": code, "type": "expense", "group": "Other"})


# codes the system posts to
A = {
    "cash": "1000", "bank": "1010", "card": "1020", "duitnow": "1030", "ar": "1100", "inventory": "1200",
    "ap": "2000", "deposits": "2100", "sst": "2200", "capital": "3000",
    "consult": "4010", "therapy": "4020", "pkgIncome": "4030", "meds": "4040", "other": "4090",
    "cogs": "5010", "oils": "5020", "stockAdj": "5030",
}


def cash_acc(method: str) -> str:
    return {"cash": A["cash"], "card": A["card"], "duitnow": A["duitnow"], "transfer": A["bank"]}.get(method, A["bank"])


def income_acc(kind: str) -> str:
    return {"cons": A["consult"], "tx": A["therapy"], "med": A["meds"], "pkg": A["pkgIncome"], "other": A["other"]}.get(kind, A["other"])


EXPENSE_CATEGORIES = [{"code": c, "label": lbl or acc(c)["name"]} for c, lbl in [
    ("6010", None), ("6020", None), ("6030", None), ("6040", None), ("6050", None), ("6060", None), ("6070", None),
    ("6080", None), ("6090", None), ("6100", None), ("6900", None),
    ("2000", "Pay supplier bill (reduces amount owed)"), ("3200", "Owner's drawings")]]

# --------------------------------------------------------------------------- Malaysian service tax (SST)
# Private healthcare, traditional & complementary medicine (T&CM) and allied health services (from 1 July 2025):
#  - 6% service tax on services to NON-Malaysian citizens; Malaysian citizens exempt
#  - consultation fees of T&CM practitioners exempt
#  - register once the 12-month value of these services (citizens' exempt services included) exceeds RM1.5 million
TAX_CODES = {
    "SV6": {"rate": 6, "label": "SV-6 · Service tax 6%"},
    "EXC": {"rate": 0, "label": "EX-CIT · Exempt (Malaysian citizen)"},
    "EXCON": {"rate": 0, "label": "EX-CON · Exempt (consultation fee)"},
    "NR": {"rate": 0, "label": "NR · Not SST-registered"},
}
DEFAULT_SST = {"registered": False, "regNo": "", "rate": 6, "effectiveFrom": "", "threshold": 1500000, "consultExempt": True, "medicinesTaxable": True}


def is_citizen(p: dict | None) -> bool:
    p = p or {}
    if p.get("citizenship"):
        return p["citizenship"] == "citizen"
    return (p.get("idType") or "mykad") == "mykad"


def tax_code_for(kind: str, patient: dict | None, sst: dict | None = None, on: str | None = None) -> str:
    sst = sst or DEFAULT_SST
    if not sst.get("registered") or (sst.get("effectiveFrom") and on and on < sst["effectiveFrom"]):
        return "NR"
    if is_citizen(patient):
        return "EXC"
    if kind == "cons" and sst.get("consultExempt", True):
        return "EXCON"
    if kind == "med" and not sst.get("medicinesTaxable", True):
        return "EXC"
    return "SV6"


def apply_tax(lines: list[dict], patient: dict | None, sst: dict | None = None, on: str | None = None) -> dict:
    """Adds net / taxCode / tax to each line. Returns {lines, subtotal, sst, total}."""
    sst = sst or DEFAULT_SST
    out = []
    for ln in lines:
        net = r2(ln["q"] * ln["p"])
        code = tax_code_for(ln["kind"], patient, sst, on)
        rate = float(sst.get("rate", 6)) if code == "SV6" else 0.0
        out.append({**ln, "net": net, "taxCode": code, "tax": r2(net * rate / 100)})
    subtotal = r2(sum(x["net"] for x in out))
    tax = r2(sum(x["tax"] for x in out))
    return {"lines": out, "subtotal": subtotal, "sst": tax, "total": r2(subtotal + tax)}


# --------------------------------------------------------------------------- periods
def _last_day(y: int, m: int) -> date:
    # m may run outside 1..12 (like JS Date); normalise
    y += (m - 1) // 12
    m = (m - 1) % 12 + 1
    return date(y, m, calendar.monthrange(y, m)[1])


def _first_day(y: int, m: int) -> date:
    y += (m - 1) // 12
    m = (m - 1) % 12 + 1
    return date(y, m, 1)


def period(key: str, today: date | None = None) -> dict:
    t = today or date.today()
    y, m = t.year, t.month
    if key == "this-month":
        return {"from": _first_day(y, m).isoformat(), "to": _last_day(y, m).isoformat(), "label": "This month"}
    if key == "last-month":
        return {"from": _first_day(y, m - 1).isoformat(), "to": _last_day(y, m - 1).isoformat(), "label": "Last month"}
    if key == "this-year":
        return {"from": f"{y}-01-01", "to": f"{y}-12-31", "label": "This year"}
    if key == "last-year":
        return {"from": f"{y - 1}-01-01", "to": f"{y - 1}-12-31", "label": "Last year"}
    return {"from": "1900-01-01", "to": "2999-12-31", "label": "All time"}


def sst_period(on: date | None = None) -> dict:
    """Two-month taxable period containing `on` (Jan–Feb, Mar–Apr …) and its due date (end of following month)."""
    d = on or date.today()
    m0 = ((d.month - 1) // 2) * 2 + 1
    start, end, due = _first_day(d.year, m0), _last_day(d.year, m0 + 1), _last_day(d.year, m0 + 2)
    mon = lambda mm: _first_day(d.year, mm).strftime("%b")  # noqa: E731
    return {"from": start.isoformat(), "to": end.isoformat(), "due": due.isoformat(), "label": f"{mon(m0)}–{mon(m0 + 1)} {d.year}"}


def sst_periods(n: int = 6, today: date | None = None) -> list[dict]:
    t = today or date.today()
    return [sst_period(_first_day(t.year, t.month - 2 * i)) for i in range(n)]


def _in(d: str, start: str, end: str) -> bool:
    return start <= d <= end


# --------------------------------------------------------------------------- reports
def balances(journal: list[dict], start: str = "1900-01-01", end: str = "2999-12-31") -> list[dict]:
    b: dict[str, dict] = {}
    for e in journal:
        if not _in(e["date"], start, end):
            continue
        b.setdefault(e["dr"], {"dr": 0.0, "cr": 0.0})["dr"] += e["amt"]
        b.setdefault(e["cr"], {"dr": 0.0, "cr": 0.0})["cr"] += e["amt"]
    out = []
    for code, v in b.items():
        a = acc(code)
        bal = v["dr"] - v["cr"] if a["type"] in DEBIT_NORMAL else v["cr"] - v["dr"]
        out.append({**a, "dr": r2(v["dr"]), "cr": r2(v["cr"]), "balance": r2(bal)})
    return sorted(out, key=lambda x: x["code"])


def trial_balance(journal: list[dict], end: str = "2999-12-31") -> dict:
    rows = []
    for a in balances(journal, "1900-01-01", end):
        net = r2(a["dr"] - a["cr"])
        row = {"code": a["code"], "name": a["name"], "type": a["type"], "debit": net if net > 0 else 0, "credit": -net if net < 0 else 0}
        if row["debit"] or row["credit"]:
            rows.append(row)
    td, tc = r2(sum(r["debit"] for r in rows)), r2(sum(r["credit"] for r in rows))
    return {"rows": rows, "totalDebit": td, "totalCredit": tc, "balanced": abs(td - tc) < 0.005}


def profit_and_loss(journal: list[dict], start: str, end: str) -> dict:
    b = balances(journal, start, end)
    pick = lambda t: [{"code": a["code"], "name": a["name"], "amount": a["balance"]} for a in b if a["type"] == t and a["balance"] != 0]  # noqa: E731
    revenue, cogs, opex = pick("income"), pick("cogs"), pick("expense")
    total = lambda xs: r2(sum(x["amount"] for x in xs))  # noqa: E731
    tr, tcogs, topex = total(revenue), total(cogs), total(opex)
    gross = r2(tr - tcogs)
    net = r2(gross - topex)
    pct = lambda v: js_round1(v / tr) if tr else 0  # noqa: E731
    return {"from": start, "to": end, "revenue": revenue, "cogs": cogs, "opex": opex, "totalRevenue": tr, "totalCogs": tcogs,
            "grossProfit": gross, "grossMargin": pct(gross), "totalOpex": topex, "netProfit": net, "netMargin": pct(net)}


def balance_sheet(journal: list[dict], as_of: str = "2999-12-31") -> dict:
    b = balances(journal, "1900-01-01", as_of)
    grp = lambda t: [{"code": a["code"], "name": a["name"], "group": a["group"], "amount": a["balance"]} for a in b if a["type"] == t and a["balance"] != 0]  # noqa: E731
    assets, liabilities, equity = grp("asset"), grp("liability"), grp("equity")
    profit = r2(sum(a["balance"] for a in b if a["type"] == "income") - sum(a["balance"] for a in b if a["type"] in ("cogs", "expense")))
    for e in equity:
        if e["code"] == "3200":
            e["amount"] = -abs(e["amount"])
    equity.append({"code": "", "name": "Profit to date (not yet closed)", "group": "Equity", "amount": profit})
    total = lambda xs: r2(sum(x["amount"] for x in xs))  # noqa: E731
    ta, tl, te = total(assets), total(liabilities), total(equity)
    return {"asOf": as_of, "assets": assets, "liabilities": liabilities, "equity": equity, "totalAssets": ta,
            "totalLiabilities": tl, "totalEquity": te, "balanced": abs(ta - tl - te) < 0.005}


def general_ledger(journal: list[dict], start: str, end: str, account: str | None = None) -> list[dict]:
    opening: dict[str, float] = {}
    rows = []
    for e in sorted(journal, key=lambda x: x["date"] + (x.get("id") or "")):
        for code, dr, cr in ((e["dr"], e["amt"], 0), (e["cr"], 0, e["amt"])):
            if account and code != account:
                continue
            a = acc(code)
            sign = 1 if a["type"] in DEBIT_NORMAL else -1
            if e["date"] < start:
                opening[code] = r2(opening.get(code, 0) + sign * (dr - cr))
                continue
            if e["date"] > end:
                continue
            opening[code] = r2(opening.get(code, 0) + sign * (dr - cr))
            rows.append({"date": e["date"], "ref": e.get("ref") or "", "description": e["d"], "code": code, "account": a["name"],
                         "debit": dr, "credit": cr, "balance": opening[code]})
    return sorted(rows, key=lambda x: (x["code"], x["date"]))


def sst_summary(transactions: list[dict], start: str, end: str, sst: dict | None = None) -> dict:
    """SST-02 for a taxable period. Tax is due when payment is received → paid money-in in the period."""
    sst = sst or DEFAULT_SST
    paid = [t for t in transactions if t["type"] == "in" and t["status"] == "paid" and _in(t["date"], start, end)]
    parts = []
    for t in paid:
        if t.get("parts"):
            parts += [{"code": p.get("taxCode") or t.get("taxCode"), "net": p["net"]} for p in t["parts"]]
        else:
            parts.append({"code": t.get("taxCode"), "net": t.get("net", t["amount"])})
    by = lambda c: r2(sum(p["net"] for p in parts if p["code"] == c))  # noqa: E731
    return {"from": start, "to": end, "registered": sst.get("registered"), "regNo": sst.get("regNo"), "rate": sst.get("rate"),
            "taxableValue": by("SV6"), "serviceTax": r2(sum(t.get("tax") or 0 for t in paid)), "exemptCitizen": by("EXC"),
            "exemptConsultation": by("EXCON"), "notRegistered": by("NR"), "invoices": len(paid)}


def sst_threshold(transactions: list[dict], sst: dict | None = None, today: date | None = None) -> dict:
    sst = sst or DEFAULT_SST
    t0 = today or date.today()
    start, end = _first_day(t0.year, t0.month - 11).isoformat(), t0.isoformat()
    value = r2(sum(t.get("net", t["amount"]) for t in transactions
                   if t["type"] == "in" and t["status"] == "paid" and _in(t["date"], start, end) and t.get("acc") != A["other"]))
    thr = float(sst.get("threshold") or 1500000)
    return {"from": start, "to": end, "value": value, "threshold": thr, "pct": min(100, js_round1(value / thr)), "mustRegister": value > thr}


# --------------------------------------------------------------------------- exports
def _cell(v) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def to_csv(rows: list[dict], columns: list[list[str]] | None = None) -> str:
    cols = columns or [[k, k] for k in (rows[0].keys() if rows else [])]

    def esc(v) -> str:
        s = _cell(v)
        return '"' + s.replace('"', '""') + '"' if any(ch in s for ch in '",\n') else s

    lines = [",".join(esc(c[1]) for c in cols)] + [",".join(esc(r.get(c[0])) for c in cols) for r in rows]
    return "﻿" + "\r\n".join(lines)


def accountant_pack(*, journal, transactions, invoices=(), packages=(), inventory=(), patients=(), sst=None, start, end, clinic="") -> list[dict]:
    """Every report the accountant needs, as sheets: [{name, columns:[[key, header]], rows}]."""
    sst = sst or DEFAULT_SST
    pl, bs, tb, s = profit_and_loss(journal, start, end), balance_sheet(journal, end), trial_balance(journal, end), sst_summary(transactions, start, end, sst)
    names = {p["id"]: p["name"] for p in patients}
    sec = [["section", "Section"], ["code", "Code"], ["name", "Account"], ["amount", "Amount (RM)"]]
    in_p = lambda x: _in(x["date"], start, end)  # noqa: E731
    return [
        {"name": "Profit & Loss", "columns": sec, "rows": [
            *[{"section": "Revenue", **r} for r in pl["revenue"]], {"section": "Revenue", "name": "Total revenue", "amount": pl["totalRevenue"]},
            *[{"section": "Cost of sales", **r} for r in pl["cogs"]], {"section": "Cost of sales", "name": "Total cost of sales", "amount": pl["totalCogs"]},
            {"section": "", "name": "Gross profit", "amount": pl["grossProfit"]}, {"section": "", "name": "Gross margin %", "amount": pl["grossMargin"]},
            *[{"section": "Operating expenses", **r} for r in pl["opex"]], {"section": "Operating expenses", "name": "Total operating expenses", "amount": pl["totalOpex"]},
            {"section": "", "name": "Net profit", "amount": pl["netProfit"]}, {"section": "", "name": "Net margin %", "amount": pl["netMargin"]}]},
        {"name": "Balance Sheet", "columns": sec, "rows": [
            *[{"section": "Assets", **r} for r in bs["assets"]], {"section": "Assets", "name": "Total assets", "amount": bs["totalAssets"]},
            *[{"section": "Liabilities", **r} for r in bs["liabilities"]], {"section": "Liabilities", "name": "Total liabilities", "amount": bs["totalLiabilities"]},
            *[{"section": "Equity", **r} for r in bs["equity"]], {"section": "Equity", "name": "Total equity", "amount": bs["totalEquity"]}]},
        {"name": "Trial Balance", "columns": [["code", "Code"], ["name", "Account"], ["debit", "Debit (RM)"], ["credit", "Credit (RM)"]],
         "rows": [*tb["rows"], {"name": "Total", "debit": tb["totalDebit"], "credit": tb["totalCredit"]}]},
        {"name": "General Ledger", "columns": [["code", "Code"], ["account", "Account"], ["date", "Date"], ["ref", "Reference"], ["description", "Description"],
                                               ["debit", "Debit (RM)"], ["credit", "Credit (RM)"], ["balance", "Balance (RM)"]], "rows": general_ledger(journal, start, end)},
        {"name": "Journal", "columns": [["date", "Date"], ["ref", "Reference"], ["d", "Description"], ["dr", "Debit code"], ["drName", "Debit account"],
                                        ["cr", "Credit code"], ["crName", "Credit account"], ["amt", "Amount (RM)"]],
         "rows": [{**e, "drName": acc(e["dr"])["name"], "crName": acc(e["cr"])["name"]} for e in journal if in_p(e)]},
        {"name": "Sales Invoices", "columns": [["date", "Date"], ["id", "Invoice no."], ["patient", "Patient"], ["method", "Payment method"],
                                               ["subtotal", "Amount excl. tax (RM)"], ["taxCode", "Tax code"], ["sst", "Service tax (RM)"], ["total", "Total (RM)"]],
         "rows": [{**i, "patient": names.get(i.get("pid"), ""), "subtotal": r2(i.get("subtotal") if i.get("subtotal") is not None else i["total"]), "sst": r2(i.get("sst") or 0),
                   "taxCode": " / ".join(dict.fromkeys((ln.get("taxCode") or "NR") for ln in (i.get("lines") or [])))} for i in invoices if in_p(i)]},
        {"name": "Cash Book (Receipts)", "columns": [["date", "Date"], ["no", "No."], ["d", "Description"], ["patient", "Patient"], ["method", "Method"], ["ref", "Reference"],
                                                     ["status", "Status"], ["net", "Amount excl. tax (RM)"], ["tax", "SST (RM)"], ["amount", "Total (RM)"]],
         "rows": [{**t, "patient": names.get(t.get("pid"), "")} for t in transactions if t["type"] == "in" and in_p(t)]},
        {"name": "Expenses (Payments)", "columns": [["date", "Date"], ["no", "No."], ["d", "Description"], ["acc", "Code"], ["accName", "Account"], ["method", "Paid by"],
                                                    ["ref", "Reference"], ["status", "Status"], ["amount", "Amount (RM)"]],
         "rows": [{**t, "accName": acc(t["acc"])["name"]} for t in transactions if t["type"] == "out" and in_p(t)]},
        {"name": "SST-02 Summary", "columns": [["item", "Item"], ["value", "Value"]], "rows": [
            {"item": "Business", "value": clinic}, {"item": "Taxable period", "value": f"{start} to {end}"},
            {"item": "SST registered", "value": "Yes" if s["registered"] else "No"}, {"item": "SST registration no.", "value": s["regNo"] or "—"},
            {"item": "Value of taxable services (non-citizens, SV-6)", "value": s["taxableValue"]}, {"item": f"Service tax payable ({_cell(s['rate'])}%)", "value": s["serviceTax"]},
            {"item": "Exempt – Malaysian citizens (EX-CIT)", "value": s["exemptCitizen"]}, {"item": "Exempt – consultation fees (EX-CON)", "value": s["exemptConsultation"]},
            {"item": "Not SST-registered (NR)", "value": s["notRegistered"]}, {"item": "Paid invoices / receipts in period", "value": s["invoices"]}]},
        {"name": "Package Deposits", "columns": [["sold", "Sold"], ["patient", "Patient"], ["pkg", "Package"], ["price", "Price (RM)"], ["paid", "Paid (RM)"],
                                                 ["balance", "Balance due (RM)"], ["used", "Sessions used"], ["sessions", "Sessions"], ["unearned", "Unearned deposit (RM)"]], "rows": list(packages)},
        {"name": "Inventory Valuation", "columns": [["id", "Code"], ["name", "Item"], ["stock", "Qty on hand"], ["cost", "Unit cost (RM)"], ["value", "Value at cost (RM)"],
                                                    ["price", "Selling price (RM)"], ["batch", "Batch"], ["exp", "Expiry"]],
         "rows": [{**i, "value": r2(i["stock"] * (i.get("cost") or 0))} for i in inventory]},
        {"name": "Chart of Accounts", "columns": [["code", "Code"], ["name", "Account"], ["type", "Type"], ["group", "Group"]], "rows": COA},
    ]


FILING_CALENDAR = [
    {"what": "SST-02 service tax return + payment", "who": "Royal Malaysian Customs (MySST)", "when": "Every 2 months, by the last day of the following month. File a nil return if no tax.", "needs": "SST-02 Summary, Sales Invoices, Cash Book", "onlyIf": "SST-registered"},
    {"what": "Income tax return — Form B (sole proprietor / partnership partner) or Form C (Sdn Bhd)", "who": "LHDN (MyTax e-Filing)", "when": "Form B: 30 June (15 July e-filing). Form C: 7 months after financial year end.", "needs": "Profit & Loss, Balance Sheet, Trial Balance, General Ledger"},
    {"what": "Tax estimate CP204 (Sdn Bhd)", "who": "LHDN", "when": "30 days before the new basis period; monthly instalments", "needs": "Profit & Loss forecast"},
    {"what": "Employer return Form E + EA forms to staff", "who": "LHDN", "when": "Form E by 31 March; EA forms to employees by end February", "needs": "Payroll records (from payroll system)"},
    {"what": "Monthly EPF, SOCSO, EIS and PCB", "who": "KWSP, PERKESO, LHDN", "when": "By the 15th of the following month", "needs": "Payroll records"},
    {"what": "Annual return + financial statements (Sdn Bhd)", "who": "SSM", "when": "Annual return within 30 days of incorporation anniversary; financial statements within 30 days of circulation", "needs": "Audited accounts"},
    {"what": "e-Invoice (MyInvois)", "who": "LHDN", "when": "Only if annual turnover is above the current exemption threshold — confirm with your accountant", "needs": "Sales Invoices"},
    {"what": "Keep all records", "who": "LHDN / Customs / SSM", "when": "7 years, in English or Bahasa Malaysia, kept in Malaysia", "needs": "Invoices, receipts, bank statements, ledgers"},
]

__all__ = ["COA", "A", "acc", "cash_acc", "income_acc", "EXPENSE_CATEGORIES", "TAX_CODES", "DEFAULT_SST", "is_citizen", "tax_code_for", "apply_tax",
           "period", "sst_period", "sst_periods", "balances", "trial_balance", "profit_and_loss", "balance_sheet", "general_ledger", "sst_summary",
           "sst_threshold", "to_csv", "accountant_pack", "FILING_CALENDAR", "r2", "timedelta"]
