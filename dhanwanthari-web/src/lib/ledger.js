// Accounting core — chart of accounts, Malaysian service tax (SST), double-entry posting and reports.
// Pure functions, no React. The server port is dhanwanthari-server/app/ledger.py — keep both in step (same codes, rounding, keys).
//
// Journal entry: { id, date: "YYYY-MM-DD", ref, d, dr: accountCode, cr: accountCode, amt }
// Transaction (money in / out, what the Transactions screen lists):
//   { id, no, date, type: "in"|"out", d, acc, method, ref, pid, status: "paid"|"pending"|"failed"|"cancelled",
//     net, tax, taxCode, amount }   (amount = net + tax)

// ---------------------------------------------------------------- chart of accounts
// type: asset | liability | equity | income | cogs | expense
export const COA = [
  ["1000", "Cash in hand", "asset", "Current assets"],
  ["1010", "Bank – current account", "asset", "Current assets"],
  ["1020", "Card terminal clearing", "asset", "Current assets"],
  ["1030", "DuitNow QR clearing", "asset", "Current assets"],
  ["1100", "Accounts receivable – patients", "asset", "Current assets"],
  ["1200", "Inventory – medicines & oils", "asset", "Current assets"],
  ["1500", "Clinic equipment", "asset", "Non-current assets"],
  ["2000", "Accounts payable – suppliers", "liability", "Current liabilities"],
  ["2100", "Package deposits (unearned revenue)", "liability", "Current liabilities"],
  ["2200", "SST payable (service tax)", "liability", "Current liabilities"],
  ["2300", "EPF / SOCSO / EIS / PCB payable", "liability", "Current liabilities"],
  ["3000", "Owner's capital", "equity", "Equity"],
  ["3100", "Retained earnings", "equity", "Equity"],
  ["3200", "Owner's drawings", "equity", "Equity"],
  ["4010", "Consultation fees", "income", "Revenue"],
  ["4020", "Treatment & therapy revenue", "income", "Revenue"],
  ["4030", "Package revenue (sessions delivered)", "income", "Revenue"],
  ["4040", "Medicine & product sales", "income", "Revenue"],
  ["4090", "Other income", "income", "Revenue"],
  ["5010", "Cost of medicines sold", "cogs", "Cost of sales"],
  ["5020", "Therapy oils & consumables used", "cogs", "Cost of sales"],
  ["5030", "Stock adjustments & write-offs", "cogs", "Cost of sales"],
  ["6010", "Staff salaries & wages", "expense", "Operating expenses"],
  ["6020", "EPF, SOCSO & EIS (employer)", "expense", "Operating expenses"],
  ["6030", "Rent", "expense", "Operating expenses"],
  ["6040", "Utilities (electricity, water, internet)", "expense", "Operating expenses"],
  ["6050", "Marketing & advertising", "expense", "Operating expenses"],
  ["6060", "Card & payment gateway fees", "expense", "Operating expenses"],
  ["6070", "Repairs & maintenance", "expense", "Operating expenses"],
  ["6080", "Professional fees (accounting, audit, legal)", "expense", "Operating expenses"],
  ["6090", "Licences, permits & registration", "expense", "Operating expenses"],
  ["6100", "Laundry & linen", "expense", "Operating expenses"],
  ["6900", "Other expenses", "expense", "Operating expenses"],
].map(([code, name, type, group]) => ({ code, name, type, group }))
export const acc = (code) => COA.find((a) => a.code === code) || { code, name: code, type: "expense", group: "Other" }
const DEBIT_NORMAL = new Set(["asset", "cogs", "expense"])

// Codes the app posts to
export const A = {
  cash: "1000", bank: "1010", card: "1020", duitnow: "1030", ar: "1100", inventory: "1200",
  ap: "2000", deposits: "2100", sst: "2200", capital: "3000",
  consult: "4010", therapy: "4020", pkgIncome: "4030", meds: "4040", other: "4090",
  cogs: "5010", oils: "5020", stockAdj: "5030",
}
export const cashAcc = (method) => ({ cash: A.cash, card: A.card, duitnow: A.duitnow, transfer: A.bank }[method] ?? A.bank)
export const incomeAcc = (kind) => ({ cons: A.consult, tx: A.therapy, med: A.meds, pkg: A.pkgIncome, other: A.other }[kind] ?? A.other)
/** Expense categories offered on "Add expense" (code, label). 2000 = paying a supplier bill. */
export const EXPENSE_CATEGORIES = [["6010"], ["6020"], ["6030"], ["6040"], ["6050"], ["6060"], ["6070"], ["6080"], ["6090"], ["6100"], ["6900"], ["2000", "Pay supplier bill (reduces amount owed)"], ["3200", "Owner's drawings"]]
  .map(([c, l]) => ({ code: c, label: l ?? acc(c).name }))

// ---------------------------------------------------------------- Malaysian service tax (SST)
// Private healthcare, traditional & complementary medicine (T&CM) and allied health services:
//  - 6% service tax on services to NON-Malaysian citizens (Group I, from 1 July 2025)
//  - Malaysian citizens: exempt
//  - consultation fees of T&CM practitioners: exempt
//  - a provider must register once taxable value exceeds RM1.5 million in 12 months
//    (the value counts services to citizens too)
// Tax codes used on invoices and in the SST-02 summary:
export const TAX_CODES = {
  SV6: { rate: 6, label: "SV-6 · Service tax 6%" },
  EXC: { rate: 0, label: "EX-CIT · Exempt (Malaysian citizen)" },
  EXCON: { rate: 0, label: "EX-CON · Exempt (consultation fee)" },
  NR: { rate: 0, label: "NR · Not SST-registered" },
}
export const DEFAULT_SST = { registered: false, regNo: "", rate: 6, effectiveFrom: "", threshold: 1500000, consultExempt: true, medicinesTaxable: true }

/** Is the patient a Malaysian citizen? Explicit field first, else MyKad ⇒ citizen, passport ⇒ not. */
export const isCitizen = (p) => (p?.citizenship ? p.citizenship === "citizen" : (p?.idType ?? "mykad") === "mykad")

/** Tax code for one invoice line. kind: cons | tx | med | pkg | other */
export function taxCodeFor(kind, patient, sst = DEFAULT_SST, date) {
  if (!sst.registered || (sst.effectiveFrom && date && date < sst.effectiveFrom)) return "NR"
  if (isCitizen(patient)) return "EXC"
  if (kind === "cons" && sst.consultExempt) return "EXCON"
  if (kind === "med" && !sst.medicinesTaxable) return "EXC"
  return "SV6"
}
export const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

/** Adds tax to invoice lines. Returns { lines:[...{taxCode, net, tax}], subtotal, sst, total } */
export function applyTax(lines, patient, sst = DEFAULT_SST, date) {
  const out = lines.map((l) => { const net = r2(l.q * l.p), code = taxCodeFor(l.kind, patient, sst, date), rate = code === "SV6" ? Number(sst.rate ?? 6) : 0; return { ...l, net, taxCode: code, tax: r2((net * rate) / 100) } })
  const subtotal = r2(out.reduce((a, l) => a + l.net, 0)), tax = r2(out.reduce((a, l) => a + l.tax, 0))
  return { lines: out, subtotal, sst: tax, total: r2(subtotal + tax) }
}

// ---------------------------------------------------------------- periods
export const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
export function period(key, today = new Date()) {
  const y = today.getFullYear(), m = today.getMonth()
  const first = (yy, mm) => iso(new Date(yy, mm, 1)), last = (yy, mm) => iso(new Date(yy, mm + 1, 0))
  switch (key) {
    case "this-month": return { from: first(y, m), to: last(y, m), label: "This month" }
    case "last-month": return { from: first(y, m - 1), to: last(y, m - 1), label: "Last month" }
    case "this-year": return { from: `${y}-01-01`, to: `${y}-12-31`, label: "This year" }
    case "last-year": return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, label: "Last year" }
    default: return { from: "1900-01-01", to: "2999-12-31", label: "All time" }
  }
}
/** SST taxable periods are two months (Jan–Feb, Mar–Apr, …). Returns the period containing `date`, plus due date. */
export function sstPeriod(date = new Date()) {
  const y = date.getFullYear(), m0 = Math.floor(date.getMonth() / 2) * 2
  const from = iso(new Date(y, m0, 1)), to = iso(new Date(y, m0 + 2, 0)), due = iso(new Date(y, m0 + 3, 0))
  const mon = (i) => new Date(y, i, 1).toLocaleString("en-MY", { month: "short" })
  return { from, to, due, label: `${mon(m0)}–${mon(m0 + 1)} ${y}` }
}
export const sstPeriods = (n = 6, today = new Date()) => Array.from({ length: n }, (_, i) => sstPeriod(new Date(today.getFullYear(), today.getMonth() - 2 * i, 1)))
const inRange = (d, from, to) => d >= from && d <= to

// ---------------------------------------------------------------- ledger reports
/** Signed balance per account over the date range (debit-normal accounts positive when debit > credit). */
export function balances(journal, from = "1900-01-01", to = "2999-12-31") {
  const b = {}
  for (const e of journal) {
    if (!inRange(e.date, from, to)) continue
    ;(b[e.dr] ??= { dr: 0, cr: 0 }).dr += e.amt
    ;(b[e.cr] ??= { dr: 0, cr: 0 }).cr += e.amt
  }
  return Object.entries(b).map(([code, v]) => { const a = acc(code), bal = DEBIT_NORMAL.has(a.type) ? v.dr - v.cr : v.cr - v.dr; return { ...a, dr: r2(v.dr), cr: r2(v.cr), balance: r2(bal) } })
    .sort((x, y) => x.code.localeCompare(y.code))
}

/** Trial balance: every account with its debit or credit balance; totals must agree. */
export function trialBalance(journal, to = "2999-12-31") {
  const rows = balances(journal, "1900-01-01", to).map((a) => { const net = r2(a.dr - a.cr); return { code: a.code, name: a.name, type: a.type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 } }).filter((r) => r.debit || r.credit)
  const td = r2(rows.reduce((s, r) => s + r.debit, 0)), tc = r2(rows.reduce((s, r) => s + r.credit, 0))
  return { rows, totalDebit: td, totalCredit: tc, balanced: Math.abs(td - tc) < 0.005 }
}

/** Profit & loss for a period: revenue, cost of sales, gross profit, operating expenses, net profit, margins. */
export function profitAndLoss(journal, from, to) {
  const b = balances(journal, from, to), pick = (t) => b.filter((a) => a.type === t && a.balance !== 0).map((a) => ({ code: a.code, name: a.name, amount: a.balance }))
  const revenue = pick("income"), cogs = pick("cogs"), opex = pick("expense")
  const sum = (xs) => r2(xs.reduce((s, x) => s + x.amount, 0))
  const totalRevenue = sum(revenue), totalCogs = sum(cogs), gross = r2(totalRevenue - totalCogs), totalOpex = sum(opex), net = r2(gross - totalOpex)
  const pct = (v) => (totalRevenue ? Math.round((v / totalRevenue) * 1000) / 10 : 0)
  return { from, to, revenue, cogs, opex, totalRevenue, totalCogs, grossProfit: gross, grossMargin: pct(gross), totalOpex, netProfit: net, netMargin: pct(net) }
}

/** Balance sheet as at a date. Current-year profit is shown inside equity so it balances. */
export function balanceSheet(journal, asOf = "2999-12-31") {
  const b = balances(journal, "1900-01-01", asOf), group = (t) => b.filter((a) => a.type === t && a.balance !== 0).map((a) => ({ code: a.code, name: a.name, group: a.group, amount: a.balance }))
  const assets = group("asset"), liabilities = group("liability"), equity = group("equity")
  const profit = r2(b.filter((a) => a.type === "income").reduce((s, a) => s + a.balance, 0) - b.filter((a) => a.type === "cogs" || a.type === "expense").reduce((s, a) => s + a.balance, 0))
  const drawings = equity.find((e) => e.code === "3200"); if (drawings) drawings.amount = -Math.abs(drawings.amount)
  equity.push({ code: "", name: "Profit to date (not yet closed)", group: "Equity", amount: profit })
  const sum = (xs) => r2(xs.reduce((s, x) => s + x.amount, 0))
  const ta = sum(assets), tl = sum(liabilities), te = sum(equity)
  return { asOf, assets, liabilities, equity, totalAssets: ta, totalLiabilities: tl, totalEquity: te, balanced: Math.abs(ta - tl - te) < 0.005 }
}

/** General ledger lines (one row per debit/credit) with running balance per account. */
export function generalLedger(journal, from, to, account) {
  const opening = {}, rows = []
  const sorted = [...journal].sort((a, b) => (a.date + (a.id ?? "")).localeCompare(b.date + (b.id ?? "")))
  for (const e of sorted) {
    for (const [code, dr, cr] of [[e.dr, e.amt, 0], [e.cr, 0, e.amt]]) {
      if (account && code !== account) continue
      const a = acc(code), sign = DEBIT_NORMAL.has(a.type) ? 1 : -1
      if (e.date < from) { opening[code] = r2((opening[code] ?? 0) + sign * (dr - cr)); continue }
      if (e.date > to) continue
      opening[code] = r2((opening[code] ?? 0) + sign * (dr - cr))
      rows.push({ date: e.date, ref: e.ref ?? "", description: e.d, code, account: a.name, debit: dr, credit: cr, balance: opening[code] })
    }
  }
  return rows.sort((x, y) => x.code.localeCompare(y.code) || x.date.localeCompare(y.date))
}

/**
 * SST-02 summary for a taxable period. Service tax is due when payment is RECEIVED,
 * so this uses paid money-in transactions dated in the period.
 */
export function sstSummary(transactions, from, to, sst = DEFAULT_SST) {
  const paid = transactions.filter((t) => t.type === "in" && t.status === "paid" && inRange(t.date, from, to))
  // split each receipt by line tax code (e.g. an exempt consultation + a taxable medicine on one invoice)
  const parts = paid.flatMap((t) => (t.parts?.length ? t.parts.map((p) => ({ code: p.taxCode ?? t.taxCode, net: p.net })) : [{ code: t.taxCode, net: t.net ?? t.amount }]))
  const by = (code) => r2(parts.filter((p) => p.code === code).reduce((s, p) => s + p.net, 0))
  const taxable = by("SV6"), tax = r2(paid.reduce((s, t) => s + (t.tax ?? 0), 0))
  return { from, to, registered: sst.registered, regNo: sst.regNo, rate: sst.rate, taxableValue: taxable, serviceTax: tax, exemptCitizen: by("EXC"), exemptConsultation: by("EXCON"), notRegistered: by("NR"), invoices: paid.length }
}

/** Rolling 12-month value of healthcare services (incl. exempt citizen services) vs the RM1.5m registration threshold. */
export function sstThreshold(transactions, sst = DEFAULT_SST, today = new Date()) {
  const from = iso(new Date(today.getFullYear(), today.getMonth() - 11, 1)), to = iso(today)
  const value = r2(transactions.filter((t) => t.type === "in" && t.status === "paid" && inRange(t.date, from, to) && t.acc !== A.other).reduce((s, t) => s + (t.net ?? t.amount), 0))
  return { from, to, value, threshold: sst.threshold, pct: Math.min(100, Math.round((value / sst.threshold) * 1000) / 10), mustRegister: value > sst.threshold }
}

// ---------------------------------------------------------------- exports
export function toCSV(rows, columns) {
  const cols = columns ?? Object.keys(rows[0] ?? {}).map((k) => [k, k])
  const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  return "﻿" + [cols.map((c) => esc(c[1])).join(","), ...rows.map((r) => cols.map((c) => esc(r[c[0]])).join(","))].join("\r\n")
}

/**
 * Every report the accountant needs for bookkeeping and tax filing, as sheets:
 * [{ name, columns:[[key,header]], rows }]. Used by the web download and the API export.
 */
export function accountantPack({ journal, transactions, invoices = [], packages = [], inventory = [], patients = [], sst = DEFAULT_SST, from, to, clinic = "" }) {
  const pl = profitAndLoss(journal, from, to), bs = balanceSheet(journal, to), tb = trialBalance(journal, to), s = sstSummary(transactions, from, to, sst)
  const pname = (id) => patients.find((p) => p.id === id)?.name ?? ""
  const money = (n) => r2(n)
  return [
    { name: "Profit & Loss", columns: [["section", "Section"], ["code", "Code"], ["name", "Account"], ["amount", "Amount (RM)"]], rows: [
      ...pl.revenue.map((r) => ({ section: "Revenue", ...r })), { section: "Revenue", name: "Total revenue", amount: pl.totalRevenue },
      ...pl.cogs.map((r) => ({ section: "Cost of sales", ...r })), { section: "Cost of sales", name: "Total cost of sales", amount: pl.totalCogs },
      { section: "", name: "Gross profit", amount: pl.grossProfit }, { section: "", name: "Gross margin %", amount: pl.grossMargin },
      ...pl.opex.map((r) => ({ section: "Operating expenses", ...r })), { section: "Operating expenses", name: "Total operating expenses", amount: pl.totalOpex },
      { section: "", name: "Net profit", amount: pl.netProfit }, { section: "", name: "Net margin %", amount: pl.netMargin }] },
    { name: "Balance Sheet", columns: [["section", "Section"], ["code", "Code"], ["name", "Account"], ["amount", "Amount (RM)"]], rows: [
      ...bs.assets.map((r) => ({ section: "Assets", ...r })), { section: "Assets", name: "Total assets", amount: bs.totalAssets },
      ...bs.liabilities.map((r) => ({ section: "Liabilities", ...r })), { section: "Liabilities", name: "Total liabilities", amount: bs.totalLiabilities },
      ...bs.equity.map((r) => ({ section: "Equity", ...r })), { section: "Equity", name: "Total equity", amount: bs.totalEquity }] },
    { name: "Trial Balance", columns: [["code", "Code"], ["name", "Account"], ["debit", "Debit (RM)"], ["credit", "Credit (RM)"]], rows: [...tb.rows, { name: "Total", debit: tb.totalDebit, credit: tb.totalCredit }] },
    { name: "General Ledger", columns: [["code", "Code"], ["account", "Account"], ["date", "Date"], ["ref", "Reference"], ["description", "Description"], ["debit", "Debit (RM)"], ["credit", "Credit (RM)"], ["balance", "Balance (RM)"]], rows: generalLedger(journal, from, to) },
    { name: "Journal", columns: [["date", "Date"], ["ref", "Reference"], ["d", "Description"], ["dr", "Debit code"], ["drName", "Debit account"], ["cr", "Credit code"], ["crName", "Credit account"], ["amt", "Amount (RM)"]], rows: journal.filter((e) => inRange(e.date, from, to)).map((e) => ({ ...e, drName: acc(e.dr).name, crName: acc(e.cr).name })) },
    { name: "Sales Invoices", columns: [["date", "Date"], ["id", "Invoice no."], ["patient", "Patient"], ["method", "Payment method"], ["subtotal", "Amount excl. tax (RM)"], ["taxCode", "Tax code"], ["sst", "Service tax (RM)"], ["total", "Total (RM)"]], rows: invoices.filter((i) => inRange(i.date, from, to)).map((i) => ({ ...i, patient: pname(i.pid), subtotal: money(i.subtotal ?? i.total), sst: money(i.sst ?? 0), taxCode: [...new Set((i.lines ?? []).map((l) => l.taxCode ?? "NR"))].join(" / ") })) },
    { name: "Cash Book (Receipts)", columns: [["date", "Date"], ["no", "No."], ["d", "Description"], ["patient", "Patient"], ["method", "Method"], ["ref", "Reference"], ["status", "Status"], ["net", "Amount excl. tax (RM)"], ["tax", "SST (RM)"], ["amount", "Total (RM)"]], rows: transactions.filter((t) => t.type === "in" && inRange(t.date, from, to)).map((t) => ({ ...t, patient: pname(t.pid) })) },
    { name: "Expenses (Payments)", columns: [["date", "Date"], ["no", "No."], ["d", "Description"], ["acc", "Code"], ["accName", "Account"], ["method", "Paid by"], ["ref", "Reference"], ["status", "Status"], ["amount", "Amount (RM)"]], rows: transactions.filter((t) => t.type === "out" && inRange(t.date, from, to)).map((t) => ({ ...t, accName: acc(t.acc).name })) },
    { name: "SST-02 Summary", columns: [["item", "Item"], ["value", "Value"]], rows: [
      { item: "Business", value: clinic }, { item: "Taxable period", value: `${from} to ${to}` }, { item: "SST registered", value: s.registered ? "Yes" : "No" }, { item: "SST registration no.", value: s.regNo || "—" },
      { item: "Value of taxable services (non-citizens, SV-6)", value: s.taxableValue }, { item: `Service tax payable (${s.rate}%)`, value: s.serviceTax },
      { item: "Exempt – Malaysian citizens (EX-CIT)", value: s.exemptCitizen }, { item: "Exempt – consultation fees (EX-CON)", value: s.exemptConsultation },
      { item: "Not SST-registered (NR)", value: s.notRegistered }, { item: "Paid invoices / receipts in period", value: s.invoices }] },
    { name: "Package Deposits", columns: [["sold", "Sold"], ["patient", "Patient"], ["pkg", "Package"], ["price", "Price (RM)"], ["paid", "Paid (RM)"], ["balance", "Balance due (RM)"], ["used", "Sessions used"], ["sessions", "Sessions"], ["unearned", "Unearned deposit (RM)"]], rows: packages },
    { name: "Inventory Valuation", columns: [["id", "Code"], ["name", "Item"], ["stock", "Qty on hand"], ["cost", "Unit cost (RM)"], ["value", "Value at cost (RM)"], ["price", "Selling price (RM)"], ["batch", "Batch"], ["exp", "Expiry"]], rows: inventory.map((i) => ({ ...i, value: money(i.stock * i.cost) })) },
    { name: "Chart of Accounts", columns: [["code", "Code"], ["name", "Account"], ["type", "Type"], ["group", "Group"]], rows: COA },
  ]
}

/** What the accountant needs, and when (shown on the Downloads page; also in the API docs). */
export const FILING_CALENDAR = [
  { what: "SST-02 service tax return + payment", who: "Royal Malaysian Customs (MySST)", when: "Every 2 months, by the last day of the following month. File a nil return if no tax.", needs: "SST-02 Summary, Sales Invoices, Cash Book", onlyIf: "SST-registered" },
  { what: "Income tax return — Form B (sole proprietor / partnership partner) or Form C (Sdn Bhd)", who: "LHDN (MyTax e-Filing)", when: "Form B: 30 June (15 July e-filing). Form C: 7 months after financial year end.", needs: "Profit & Loss, Balance Sheet, Trial Balance, General Ledger" },
  { what: "Tax estimate CP204 (Sdn Bhd)", who: "LHDN", when: "30 days before the new basis period; monthly instalments", needs: "Profit & Loss forecast" },
  { what: "Employer return Form E + EA forms to staff", who: "LHDN", when: "Form E by 31 March; EA forms to employees by end February", needs: "Payroll records (from payroll system)" },
  { what: "Monthly EPF, SOCSO, EIS and PCB", who: "KWSP, PERKESO, LHDN", when: "By the 15th of the following month", needs: "Payroll records" },
  { what: "Annual return + financial statements (Sdn Bhd)", who: "SSM", when: "Annual return within 30 days of incorporation anniversary; financial statements within 30 days of circulation", needs: "Audited accounts" },
  { what: "e-Invoice (MyInvois)", who: "LHDN", when: "Only if annual turnover is above the current exemption threshold — confirm with your accountant", needs: "Sales Invoices" },
  { what: "Keep all records", who: "LHDN / Customs / SSM", when: "7 years, in English or Bahasa Malaysia, kept in Malaysia", needs: "Invoices, receipts, bank statements, ledgers" },
]
