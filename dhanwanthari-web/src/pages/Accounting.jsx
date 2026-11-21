// Accounting: Transactions · Reports (P&L, Balance sheet, Trial balance) · General ledger · SST · Downloads · Chart of accounts.
// All figures come from the double-entry journal built by the store (see src/lib/ledger.js for the rules).
import { useMemo, useState } from "react"
import { Wallet, Receipt, TrendingUp, Clock, Plus, Minus, Search, Download, FileSpreadsheet, FileText, Landmark, Percent, BookOpen, ListTree, CheckCircle2, XCircle, Ban, RotateCcw, AlertTriangle, CalendarClock, ShieldCheck, Scale } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input, NativeSelect, Label } from "@/components/ui/input"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Table, THead, TR, TH, TD } from "@/components/ui/table"
import { Progress } from "@/components/ui/progress"
import { PageHead, Kpi, IconChip } from "@/components/kit"
import { useLang } from "@/lib/i18n"
import { useStore } from "@/lib/store"
import { rm, cn } from "@/lib/utils"
import { CLINIC } from "@data/clinic.js"
import { pkgOf, packageState } from "@/lib/rules"
import { COA, acc, A, balances, EXPENSE_CATEGORIES, TAX_CODES, period, sstPeriods, profitAndLoss, balanceSheet, trialBalance, generalLedger, sstSummary, sstThreshold, accountantPack, toCSV, FILING_CALENDAR, taxCodeFor } from "@/lib/ledger"

const METHOD = { cash: "Cash", card: "Card", duitnow: "DuitNow QR", transfer: "Bank transfer", package: "Package" }
const STATUS = { paid: ["ok", "Paid"], pending: ["warn", "Pending"], failed: ["danger", "Failed"], cancelled: ["muted", "Cancelled"] }
const PERIODS = [["this-month", "This month"], ["last-month", "Last month"], ["this-year", "This year"], ["all", "All time"]]
const money = (n) => (n < 0 ? `-${rm(-n)}` : rm(n))

/** Download helpers (CSV / Excel). Work in the browser; the API offers the same files for the server copy. */
export async function saveBlob(blob, name) {
  // Inside a Claude artifact preview, files go through its downloads capability (viewer confirms); elsewhere a normal browser download.
  try { if (typeof window !== "undefined" && window.claude && typeof window.claude.use === "function") { const dl = await window.claude.use("downloads"); if (dl) { await dl.save({ filename: name, data: blob }); return } } } catch (e) { if (e && (e.code === "declined" || e.code === "rate_limited")) return }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 500)
}
export const downloadCSV = (sheet, name) => saveBlob(new Blob([toCSV(sheet.rows, sheet.columns)], { type: "text/csv;charset=utf-8" }), name)
export async function downloadXLSX(sheets, name) {
  const X = await import("xlsx")
  const wb = X.utils.book_new()
  for (const sh of sheets) {
    const aoa = [sh.columns.map((c) => c[1]), ...sh.rows.map((r) => sh.columns.map((c) => r[c[0]] ?? ""))]
    const ws = X.utils.aoa_to_sheet(aoa); ws["!cols"] = sh.columns.map((c) => ({ wch: Math.max(10, Math.min(48, c[1].length + 4, ...sh.rows.slice(0, 200).map((r) => String(r[c[0]] ?? "").length + 2))) }))
    X.utils.book_append_sheet(wb, ws, sh.name.slice(0, 31))
  }
  saveBlob(new Blob([X.write(wb, { type: "array", bookType: "xlsx" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name)
}

function PeriodPick({ value, onChange }) {
  return <div className="flex flex-wrap gap-1.5">{PERIODS.map(([k, l]) => <button key={k} onClick={() => onChange(k)} aria-pressed={value === k} className={cn("cursor-pointer rounded-xl border px-3 py-1.5 text-sm font-semibold", value === k ? "border-herb bg-herb-soft text-herb" : "bg-white text-muted-foreground hover:text-foreground")}>{l}</button>)}</div>
}
const CodeName = ({ code }) => <span className="whitespace-nowrap"><span className="mr-1.5 font-mono text-xs text-muted-foreground">{code}</span>{acc(code).name}</span>

/** builds the accountant pack inputs from store state */
export function packInputs(S, from, to) {
  return {
    journal: S.J, transactions: S.TX ?? [], invoices: S.INVC, inventory: S.INV.filter((i) => !i.archived), patients: S.P, sst: S.SET?.sst, from, to, clinic: CLINIC.name,
    packages: S.PK.map((k) => { const s = packageState(k); return { sold: k.sold, patient: S.P.find((p) => p.id === k.pid)?.name, pkg: s.g.name.en, price: s.g.price, paid: s.paid, balance: s.balance, used: k.used, sessions: s.g.sessions, unearned: Math.max(0, Math.round((s.paid - k.used * s.per) * 100) / 100) } }),
  }
}

// ================================================================ Transactions
export function Transactions() {
  const { day } = useLang(); const st = useStore(); const { S } = st
  const [tab, setTab] = useState("all"); const [q, setQ] = useState(""); const [dlg, setDlg] = useState(null); const [act, setAct] = useState(null)
  const TX = S.TX ?? []
  const paidIn = TX.filter((t) => t.type === "in" && t.status === "paid"), paidOut = TX.filter((t) => t.type === "out" && t.status === "paid")
  const received = paidIn.reduce((a, t) => a + t.amount, 0), spent = paidOut.reduce((a, t) => a + t.amount, 0), pending = TX.filter((t) => t.status === "pending")
  const term = q.trim().toLowerCase()
  const list = TX.filter((t) => (tab === "all" || t.status === tab) && (!term || [t.d, t.no, t.ref, acc(t.acc).name, t.acc].some((v) => (v || "").toLowerCase().includes(term))))
  return (
    <div className="grid gap-5">
      <PageHead icon={Receipt} tone="herb" title="Transactions" sub="Payments received and expenses. Every row posts to the ledger automatically."
        right={<><Button variant="outline" onClick={() => setDlg("out")}><Minus />Add expense</Button><Button variant="herb" onClick={() => setDlg("in")}><Plus />Add payment</Button></>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Wallet} tone="herb" label="Total received" value={rm(received)} sub={`${paidIn.length} paid payments, all time`} />
        <Kpi icon={Receipt} tone="red" label="Expenses" value={money(-spent)} sub={`${paidOut.length} paid expenses`} />
        <Kpi icon={TrendingUp} tone="cyan" label="Cash profit" value={money(received - spent)} sub="Received minus expenses paid (see Reports for accrual P&L)" />
        <Kpi icon={Clock} tone="amber" label="Pending" value={rm(pending.reduce((a, t) => a + t.amount, 0))} sub={`${pending.length} awaiting payment`} />
      </div>
      <Card><CardHeader><CardTitle>Transactions</CardTitle><div className="relative ml-auto w-full max-w-sm"><Search className="absolute top-3 left-3 size-4 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search description, account or ref" className="pl-9" aria-label="Search transactions" /></div></CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap gap-1.5">{[["all", "All"], ["paid", "Paid"], ["pending", "Pending"], ["failed", "Failed"], ["cancelled", "Cancelled"]].map(([k, l]) => <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={cn("cursor-pointer rounded-xl border px-3.5 py-1.5 text-sm font-semibold", tab === k ? "border-herb bg-herb-soft text-herb" : "bg-white text-muted-foreground")}>{l} {k !== "all" && <span className="ml-1 text-xs opacity-70">{TX.filter((t) => t.status === k).length}</span>}</button>)}</div>
          <div className="rounded-xl border"><Table>
            <THead><tr><TH>No.</TH><TH>Date</TH><TH>Description</TH><TH>Account</TH><TH>Method</TH><TH>Reference</TH><TH>Status</TH><TH className="text-right">Amount</TH><TH /></tr></THead>
            <tbody>{list.map((t) => <TR key={t.id}>
              <TD className="font-mono text-xs">{t.no}</TD><TD className="whitespace-nowrap">{day(t.date)}</TD><TD className="min-w-40">{t.d}</TD><TD className="text-xs"><CodeName code={t.acc} /></TD>
              <TD>{METHOD[t.method] ?? t.method}</TD><TD className="text-xs break-all">{t.ref || "—"}</TD>
              <TD><Badge variant={STATUS[t.status][0]}>{STATUS[t.status][1]}</Badge></TD>
              <TD className={cn("text-right font-semibold whitespace-nowrap", t.type === "out" && "text-destructive")}>{t.type === "out" ? "-" : ""}{rm(t.amount)}{t.type === "in" && <div className="text-[11px] font-normal text-muted-foreground">{t.tax > 0 ? `incl. SST ${rm(t.tax)}` : t.taxCode}</div>}</TD>
              <TD className="text-right">{t.status !== "cancelled" && <Button size="sm" variant="ghost" onClick={() => setAct(t.id)}>Update</Button>}</TD></TR>)}
              {list.length === 0 && <TR><TD colSpan={9} className="p-8 text-center text-sm text-muted-foreground">{TX.length ? "Nothing matches." : "No transactions yet. They appear when you take payments in Billing or Packages, or use Add payment / Add expense."}</TD></TR>}</tbody></Table></div>
        </CardContent></Card>
      <MoneyDialog open={dlg} close={() => setDlg(null)} />
      <StatusDialog id={act} close={() => setAct(null)} />
    </div>)
}

function MoneyDialog({ open, close }) {
  const st = useStore(); const { S } = st
  const [f, setF] = useState({ code: "6030", kind: "other", amount: "", method: "transfer", status: "paid", note: "", pid: "", d: "", ref: "" }); const [err, setErr] = useState(null)
  const set = (p) => setF((o) => ({ ...o, ...p }))
  const isIn = open === "in", pt = S.P.find((p) => p.id === f.pid)
  const code = isIn ? taxCodeFor(f.kind, pt ?? { citizenship: "citizen" }, S.SET?.sst, new Date().toISOString().slice(0, 10)) : null
  const tax = code === "SV6" ? Math.round(Number(f.amount || 0) * (S.SET?.sst?.rate ?? 6)) / 100 : 0
  const save = async () => { const e = await (isIn ? st.addPayment({ pid: f.pid || undefined, d: f.d, kind: f.kind, amount: f.amount, method: f.method, status: f.status, ref: f.ref }) : st.addExpense({ code: f.code, amount: f.amount, method: f.method, note: f.note, status: f.status, ref: f.ref })); if (e) setErr(e); else { setErr(null); set({ amount: "", note: "", d: "", ref: "", status: "paid" }); close() } }
  return (
    <Dialog open={!!open} onOpenChange={(o) => { if (!o) { set({ status: "paid" }); setErr(null); close() } }}><DialogContent title={isIn ? "Add payment (money in)" : "Add expense (money out)"} description={isIn ? "For money received outside Billing, e.g. a retail sale or other income." : "Rent, salaries, utilities, supplier bills and other costs."}>
      {isIn ? <>
        <Label>Description<Input value={f.d} onChange={(e) => set({ d: e.target.value })} placeholder="e.g. Retail sale – Murivenna 200ml" /></Label>
        <Label>Income account<NativeSelect value={f.kind} onChange={(e) => set({ kind: e.target.value })}>{[["cons", A.consult], ["tx", A.therapy], ["med", A.meds], ["other", A.other]].map(([k, c]) => <option key={k} value={k}>{c} · {acc(c).name}</option>)}</NativeSelect></Label>
        <Label>Patient (optional, decides SST)<NativeSelect value={f.pid} onChange={(e) => set({ pid: e.target.value })}><option value="">Walk-in / not a patient</option>{S.P.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.id}</option>)}</NativeSelect></Label>
      </> : <Label>Category<NativeSelect value={f.code} onChange={(e) => set({ code: e.target.value })}>{EXPENSE_CATEGORIES.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}</NativeSelect></Label>}
      <div className="grid grid-cols-2 gap-3">
        <Label>Amount (RM){isIn ? " before SST" : ""}<Input inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} /></Label>
        <Label>{isIn ? "Received by" : "Paid by"}<NativeSelect value={f.method} onChange={(e) => set({ method: e.target.value })}>{["transfer", "duitnow", "card", "cash"].map((m) => <option key={m} value={m}>{METHOD[m]}</option>)}</NativeSelect></Label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Label>Status<NativeSelect value={f.status} onChange={(e) => set({ status: e.target.value })}><option value="paid">Paid</option><option value="pending">{isIn ? "Pending (not received yet)" : "Pending (bill not paid yet)"}</option></NativeSelect></Label>
        <Label>Reference<Input value={f.ref} onChange={(e) => set({ ref: e.target.value })} placeholder={isIn ? "Receipt / bank ref" : "Bill / invoice no."} /></Label>
      </div>
      {!isIn && <Label>Note<Input value={f.note} onChange={(e) => set({ note: e.target.value })} placeholder="e.g. November rent" /></Label>}
      {isIn && <p className="rounded-xl bg-muted p-3 text-sm">Tax code <b>{TAX_CODES[code].label}</b>{tax > 0 ? <> · SST <b>{rm(tax)}</b> · total <b>{rm(Number(f.amount || 0) + tax)}</b></> : null}</p>}
      {err && <p className="text-sm font-semibold text-destructive">{err.en}</p>}
      <Button variant={isIn ? "herb" : "default"} onClick={save}><CheckCircle2 />Save</Button>
    </DialogContent></Dialog>)
}

function StatusDialog({ id, close }) {
  const st = useStore(); const t = (st.S.TX ?? []).find((z) => z.id === id); const [m, setM] = useState("")
  if (!t) return null
  const method = m || t.method
  const opts = t.status === "paid" ? [["cancelled", Ban, "Cancel / refund", "Reverses the postings and the money", "outline"]]
    : [["paid", CheckCircle2, t.type === "in" ? "Mark as paid (money received)" : "Mark as paid", "", "herb"], ...(t.status === "pending" ? [["failed", XCircle, "Mark as failed", "e.g. card declined, transfer bounced. Still owed.", "outline"]] : [["pending", RotateCcw, "Back to pending", "Try again", "outline"]]), ["cancelled", Ban, "Cancel", "No longer owed; reverses the postings", "outline"]]
  return (
    <Dialog open={!!id} onOpenChange={(o) => { if (!o) { close(); setM("") } }}><DialogContent title={`${t.no} · ${STATUS[t.status][1]}`} description={`${t.d} · ${rm(t.amount)}`}>
      {t.status !== "paid" && <Label>{t.type === "in" ? "Received by" : "Paid by"}<NativeSelect value={method} onChange={(e) => setM(e.target.value)}>{["transfer", "duitnow", "card", "cash"].map((x) => <option key={x} value={x}>{METHOD[x]}</option>)}</NativeSelect></Label>}
      <div className="grid gap-2">{opts.map(([to, I, l, sub, v]) => <Button key={to} variant={v} className="h-auto justify-start py-2.5 text-left" onClick={() => { st.setTxStatus(t.id, to, method); close(); setM("") }}><I /><span className="grid"><span>{l}</span>{sub && <span className="text-xs font-normal opacity-70">{sub}</span>}</span></Button>)}</div>
      {(t.log ?? []).length > 0 && <div className="grid gap-0.5 text-xs text-muted-foreground">{t.log.map((g, i) => <span key={i}>{new Date(g.at).toLocaleString("en-MY")} · {g.from} → {g.to}</span>)}</div>}
    </DialogContent></Dialog>)
}

// ================================================================ Reports
export function Reports() {
  const { S } = useStore(); const [p, setP] = useState("this-month"); const [tab, setTab] = useState("pl")
  const per = period(p), pl = useMemo(() => profitAndLoss(S.J, per.from, per.to), [S.J, per.from, per.to]), bs = useMemo(() => balanceSheet(S.J, per.to), [S.J, per.to]), tb = useMemo(() => trialBalance(S.J, per.to), [S.J, per.to])
  const fmt = (d) => new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })
  const range = p === "all" ? "All time" : `${per.label}: ${fmt(per.from)} – ${fmt(per.to)}`
  const pack = () => accountantPack(packInputs(S, per.from, per.to))
  const Line = ({ code, name, amount, neg }) => <div className="flex justify-between gap-3 py-1.5 text-sm"><span>{code && <span className="mr-2 font-mono text-xs text-muted-foreground">{code}</span>}{name}</span><span className="whitespace-nowrap">{money(neg ? -amount : amount)}</span></div>
  const Sub = ({ l, v, neg }) => <div className="flex justify-between border-t pt-2 text-sm font-bold"><span>{l}</span><span>{money(neg ? -v : v)}</span></div>
  const H = ({ children }) => <div className="mt-3 text-xs font-bold tracking-wide text-muted-foreground uppercase">{children}</div>
  const Empty = () => <p className="py-1.5 text-sm text-muted-foreground italic">No entries</p>
  return (
    <div className="grid gap-5">
      <PageHead icon={Scale} tone="blue" title="Reports" sub="Profit and loss, balance sheet and trial balance, by chart-of-accounts code."
        right={<Button variant="outline" onClick={() => downloadXLSX(pack().filter((s) => ["Profit & Loss", "Balance Sheet", "Trial Balance"].includes(s.name)), `reports_${per.from}_${per.to}.xlsx`)}><Download />Download Excel</Button>} />
      <div className="flex flex-wrap items-center gap-2">{[["pl", "Profit & Loss"], ["bs", "Balance Sheet"], ["tb", "Trial Balance"]].map(([k, l]) => <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={cn("cursor-pointer rounded-full px-4 py-2 text-sm font-bold", tab === k ? "ln-grad text-white" : "border bg-white text-muted-foreground")}>{l}</button>)}<div className="ml-auto"><PeriodPick value={p} onChange={setP} /></div></div>
      {tab === "pl" && <Card><CardHeader><div><CardTitle>Profit & Loss</CardTitle><p className="text-sm text-muted-foreground">{range} · posted transactions (accrual)</p></div></CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <div><H>Revenue</H>{pl.revenue.length ? pl.revenue.map((r) => <Line key={r.code} {...r} />) : <Empty />}<Sub l="Total revenue" v={pl.totalRevenue} />
            <H>Cost of sales</H>{pl.cogs.length ? pl.cogs.map((r) => <Line key={r.code} {...r} neg />) : <Empty />}<Sub l="Total cost of sales" v={pl.totalCogs} neg />
            <div className="mt-3 flex justify-between rounded-xl bg-muted px-4 py-3 font-bold"><span>Gross profit <span className="ml-1 text-xs font-normal text-muted-foreground">{pl.grossMargin}% margin</span></span><span>{money(pl.grossProfit)}</span></div></div>
          <div><H>Operating expenses</H>{pl.opex.length ? pl.opex.map((r) => <Line key={r.code} {...r} neg />) : <Empty />}<Sub l="Total operating expenses" v={pl.totalOpex} neg />
            <div className="mt-4 flex items-center justify-between rounded-2xl border border-herb/30 bg-herb-soft p-5"><div><b>Net profit</b><div className="text-xs text-muted-foreground">{pl.netMargin}% net margin</div></div><span className={cn("font-display text-3xl font-bold", pl.netProfit < 0 ? "text-destructive" : "text-herb")}>{money(pl.netProfit)}</span></div>
            <p className="mt-3 text-xs text-muted-foreground">Package money is revenue only when a session is delivered (4030); until then it sits in 2100 Package deposits. SST collected is not revenue; it sits in 2200 SST payable.</p></div>
        </CardContent></Card>}
      {tab === "bs" && <Card><CardHeader><div><CardTitle>Balance Sheet</CardTitle><p className="text-sm text-muted-foreground">As at {fmt(per.to > new Date().toISOString().slice(0, 10) ? new Date() : per.to)}</p></div>{bs.balanced ? <Badge variant="ok" className="ml-auto"><CheckCircle2 />Balanced</Badge> : <Badge variant="danger" className="ml-auto">Not balanced</Badge>}</CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <div><H>Assets</H>{bs.assets.length ? bs.assets.map((r) => <Line key={r.code} {...r} />) : <Empty />}<Sub l="Total assets" v={bs.totalAssets} /></div>
          <div><H>Liabilities</H>{bs.liabilities.length ? bs.liabilities.map((r) => <Line key={r.code} {...r} />) : <Empty />}<Sub l="Total liabilities" v={bs.totalLiabilities} />
            <H>Equity</H>{bs.equity.map((r, i) => <Line key={i} {...r} />)}<Sub l="Total equity" v={bs.totalEquity} />
            <div className="mt-3 flex justify-between rounded-xl bg-muted px-4 py-3 text-sm font-bold"><span>Liabilities + equity</span><span>{money(bs.totalLiabilities + bs.totalEquity)}</span></div></div>
        </CardContent></Card>}
      {tab === "tb" && <Card><CardHeader><div><CardTitle>Trial Balance</CardTitle><p className="text-sm text-muted-foreground">Cumulative to {fmt(per.to > new Date().toISOString().slice(0, 10) ? new Date() : per.to)}</p></div>{tb.balanced ? <Badge variant="ok" className="ml-auto"><CheckCircle2 />Debits = credits</Badge> : <Badge variant="danger" className="ml-auto">Out of balance</Badge>}</CardHeader>
        <CardContent className="p-0"><Table><THead><tr><TH>Code</TH><TH>Account</TH><TH className="text-right">Debit</TH><TH className="text-right">Credit</TH></tr></THead>
          <tbody>{tb.rows.map((r) => <TR key={r.code}><TD className="font-mono text-xs">{r.code}</TD><TD>{r.name}</TD><TD className="text-right">{r.debit ? rm(r.debit) : ""}</TD><TD className="text-right">{r.credit ? rm(r.credit) : ""}</TD></TR>)}
            {tb.rows.length === 0 && <TR><TD colSpan={4} className="p-6 text-center text-sm text-muted-foreground">No entries yet.</TD></TR>}
            <TR className="bg-muted font-bold"><TD /><TD>Total</TD><TD className="text-right">{rm(tb.totalDebit)}</TD><TD className="text-right">{rm(tb.totalCredit)}</TD></TR></tbody></Table></CardContent></Card>}
    </div>)
}

// ================================================================ General ledger
export function Ledger() {
  const { day } = useLang(); const { S } = useStore(); const [p, setP] = useState("this-month"); const [a, setA] = useState("")
  const per = period(p), rows = useMemo(() => generalLedger(S.J, per.from, per.to, a || undefined), [S.J, per.from, per.to, a])
  const sheet = accountantPack(packInputs(S, per.from, per.to)).find((s) => s.name === "General Ledger"), filtered = { ...sheet, rows }
  const used = [...new Set(S.J.flatMap((e) => [e.dr, e.cr]))].sort()
  return (
    <div className="grid gap-5">
      <PageHead icon={BookOpen} tone="violet" title="General ledger" sub="Every debit and credit by account, with running balance. This is the file your accountant asks for."
        right={<><Button variant="outline" onClick={() => downloadCSV(filtered, `general-ledger_${per.from}_${per.to}.csv`)}><FileText />CSV</Button><Button onClick={() => downloadXLSX([filtered], `general-ledger_${per.from}_${per.to}.xlsx`)}><FileSpreadsheet />Excel</Button></>} />
      <div className="flex flex-wrap items-center gap-2"><NativeSelect value={a} onChange={(e) => setA(e.target.value)} className="w-72" aria-label="Account"><option value="">All accounts</option>{used.map((c) => <option key={c} value={c}>{c} · {acc(c).name}</option>)}</NativeSelect><div className="ml-auto"><PeriodPick value={p} onChange={setP} /></div></div>
      <Card><CardContent className="p-0"><Table><THead><tr><TH>Account</TH><TH>Date</TH><TH>Ref</TH><TH>Description</TH><TH className="text-right">Debit</TH><TH className="text-right">Credit</TH><TH className="text-right">Balance</TH></tr></THead>
        <tbody>{rows.map((r, i) => <TR key={i}><TD className="text-xs"><CodeName code={r.code} /></TD><TD className="whitespace-nowrap">{day(r.date)}</TD><TD className="font-mono text-xs">{r.ref}</TD><TD>{r.description}</TD><TD className="text-right">{r.debit ? rm(r.debit) : ""}</TD><TD className="text-right">{r.credit ? rm(r.credit) : ""}</TD><TD className="text-right font-semibold">{money(r.balance)}</TD></TR>)}
          {rows.length === 0 && <TR><TD colSpan={7} className="p-8 text-center text-sm text-muted-foreground">No ledger entries for this period.</TD></TR>}</tbody></Table></CardContent></Card>
    </div>)
}

// ================================================================ SST
export function SST() {
  const st = useStore(); const { S } = st; const sst = S.SET?.sst
  const [f, setF] = useState(sst); const [pi, setPi] = useState(0)
  const pers = sstPeriods(6), cur = pers[pi], sum = sstSummary(S.TX ?? [], cur.from, cur.to, sst), th = sstThreshold(S.TX ?? [], sst)
  const sheet = accountantPack(packInputs(S, cur.from, cur.to)).find((s) => s.name === "SST-02 Summary")
  const fmt = (d) => new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })
  return (
    <div className="grid gap-5">
      <PageHead icon={Percent} tone="amber" title="SST (service tax)" sub="Malaysian service tax for private healthcare and traditional & complementary medicine (T&CM)." />
      <Card className="border-gold/30 bg-gold-soft/40"><CardContent className="grid gap-2 p-5 text-sm">
        <b className="flex items-center gap-2"><ShieldCheck className="size-4 text-gold" />How SST applies to this centre</b>
        <ul className="grid list-disc gap-1 pl-5">
          <li><b>6% service tax</b> on healthcare and T&CM services to <b>non-Malaysian citizens</b> (from 1 July 2025).</li>
          <li><b>Malaysian citizens are exempt.</b> T&CM practitioners' <b>consultation fees are exempt</b>.</li>
          <li>You must <b>register</b> with Customs once the value of your healthcare services (including the exempt ones for citizens) passes <b>RM1.5 million in 12 months</b>. Until then, charge no SST.</li>
          <li>Registered: show your SST number on invoices, file <b>SST-02 every 2 months</b> by the end of the following month, and pay the tax collected.</li>
        </ul>
        <p className="text-xs text-muted-foreground">Rules change: confirm the treatment of each service (and of medicines sold) with your tax agent. The settings below control what the system charges.</p></CardContent></Card>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card><CardHeader><CardTitle>Settings</CardTitle></CardHeader><CardContent className="grid gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm font-semibold"><input type="checkbox" className="size-4 accent-[#1f7a3f]" checked={f.registered} onChange={(e) => setF({ ...f, registered: e.target.checked })} />Registered for service tax</label>
          <div className="grid grid-cols-2 gap-3"><Label>SST registration no.<Input value={f.regNo} onChange={(e) => setF({ ...f, regNo: e.target.value })} placeholder="W10-1234-56789012" disabled={!f.registered} /></Label>
            <Label>Registered from<Input type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} disabled={!f.registered} /></Label></div>
          <Label>Rate (%)<Input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: Number(e.target.value) || 0 })} /></Label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[#1f7a3f]" checked={f.consultExempt} onChange={(e) => setF({ ...f, consultExempt: e.target.checked })} />Consultation fees exempt</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[#1f7a3f]" checked={f.medicinesTaxable} onChange={(e) => setF({ ...f, medicinesTaxable: e.target.checked })} />Charge SST on medicines dispensed to non-citizens</label>
          <Button onClick={() => st.setSST(f)}><CheckCircle2 />Save settings</Button>
          <div className="grid gap-1 rounded-xl bg-muted p-3 text-xs">{Object.entries(TAX_CODES).map(([k, v]) => <span key={k}><b>{v.label}</b></span>)}</div>
        </CardContent></Card>
        <div className="grid content-start gap-4">
          <Card><CardHeader><CardTitle>Registration threshold</CardTitle>{th.mustRegister ? <Badge variant="danger" className="ml-auto"><AlertTriangle />Over threshold: register</Badge> : <Badge variant="ok" className="ml-auto">Below threshold</Badge>}</CardHeader><CardContent className="grid gap-2">
            <Progress value={th.pct} color={th.pct > 80 ? "var(--destructive)" : "var(--gold)"} />
            <span className="text-sm"><b>{rm(th.value)}</b> of {rm(th.threshold)} in the last 12 months ({fmt(th.from)} – {fmt(th.to)}) · {th.pct}%</span></CardContent></Card>
          <Card><CardHeader><CardTitle>SST-02 summary</CardTitle><NativeSelect value={pi} onChange={(e) => setPi(Number(e.target.value))} className="ml-auto w-44" aria-label="Taxable period">{pers.map((x, i) => <option key={x.from} value={i}>{x.label}</option>)}</NativeSelect></CardHeader>
            <CardContent className="grid gap-2 text-sm">
              {[["Value of taxable services (SV-6)", rm(sum.taxableValue)], [`Service tax payable (${sum.rate}%)`, rm(sum.serviceTax)], ["Exempt: Malaysian citizens", rm(sum.exemptCitizen)], ["Exempt: consultation fees", rm(sum.exemptConsultation)], ["Not registered (no SST charged)", rm(sum.notRegistered)]].map(([l, v], i) => <div key={l} className={cn("flex justify-between", i === 1 && "rounded-xl bg-gold-soft px-3 py-2 font-bold")}><span>{l}</span><span>{v}</span></div>)}
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarClock className="size-3.5" />Period {fmt(cur.from)} – {fmt(cur.to)} · file and pay by <b>{fmt(cur.due)}</b>. Based on payments received (tax is due when paid).</p>
              <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => downloadCSV(sheet, `SST-02_${cur.from}_${cur.to}.csv`)}><FileText />CSV</Button><Button size="sm" onClick={() => downloadXLSX(accountantPack(packInputs(S, cur.from, cur.to)).filter((s) => ["SST-02 Summary", "Sales Invoices", "Cash Book (Receipts)"].includes(s.name)), `SST-02_${cur.from}_${cur.to}.xlsx`)}><FileSpreadsheet />Excel with invoices</Button></div>
            </CardContent></Card>
        </div>
      </div>
    </div>)
}

// ================================================================ Downloads (accountant pack)
export function Downloads() {
  const { S } = useStore(); const [p, setP] = useState("this-month")
  const per = period(p), sheets = accountantPack(packInputs(S, per.from, per.to))
  const what = { "Profit & Loss": "Income tax return (Form B / C), management review", "Balance Sheet": "Form C, bank loans, year-end accounts", "Trial Balance": "Accountant's year-end closing", "General Ledger": "Bookkeeping, audit, LHDN queries", "Journal": "Audit trail of every posting", "Sales Invoices": "SST-02, e-Invoice reconciliation", "Cash Book (Receipts)": "Bank reconciliation", "Expenses (Payments)": "Allowable expenses for tax", "SST-02 Summary": "Customs SST-02 return (if registered)", "Package Deposits": "Unearned revenue and balances owed", "Inventory Valuation": "Closing stock for the year-end accounts", "Chart of Accounts": "Mapping to the accountant's software" }
  return (
    <div className="grid gap-5">
      <PageHead icon={Download} tone="cyan" title="Downloads for your accountant" sub="Bookkeeping and tax reports in Excel or CSV. Send the full pack at month end and year end."
        right={<Button variant="herb" size="lg" onClick={() => downloadXLSX(sheets, `accountant-pack_${per.from}_${per.to}.xlsx`)}><FileSpreadsheet />Download full pack (Excel)</Button>} />
      <PeriodPick value={p} onChange={setP} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{sheets.map((s) => <div key={s.name} className="ln-shadow grid gap-2 rounded-2xl border bg-white p-4">
        <div className="flex items-center gap-2"><IconChip icon={FileSpreadsheet} tone="herb" size="sm" /><b>{s.name}</b><Badge variant="muted" className="ml-auto">{s.rows.length} rows</Badge></div>
        <p className="text-xs text-muted-foreground">{what[s.name]}</p>
        <div className="mt-auto flex gap-2"><Button size="sm" variant="outline" onClick={() => downloadCSV(s, `${s.name.replace(/\W+/g, "-").toLowerCase()}_${per.from}_${per.to}.csv`)}><FileText />CSV</Button><Button size="sm" onClick={() => downloadXLSX([s], `${s.name.replace(/\W+/g, "-").toLowerCase()}_${per.from}_${per.to}.xlsx`)}><FileSpreadsheet />Excel</Button></div></div>)}</div>
      <Card><CardHeader><CardTitle><CalendarClock className="size-4 text-primary" />What to submit, to whom, and when (Malaysia)</CardTitle></CardHeader><CardContent className="p-0"><Table>
        <THead><tr><TH>Submission</TH><TH>To</TH><TH>When</TH><TH>Reports from this system</TH></tr></THead>
        <tbody>{FILING_CALENDAR.map((r) => <TR key={r.what}><TD className="min-w-56 font-semibold">{r.what}{r.onlyIf && <Badge variant="gold" className="ml-1.5">{r.onlyIf}</Badge>}</TD><TD>{r.who}</TD><TD className="min-w-56 text-xs">{r.when}</TD><TD className="text-xs">{r.needs}</TD></TR>)}</tbody></Table>
        <p className="px-5 py-3 text-xs text-muted-foreground">Deadlines and thresholds change; your accountant or tax agent confirms what applies to the centre.</p></CardContent></Card>
    </div>)
}

// ================================================================ Chart of accounts
export function ChartOfAccounts() {
  const st = useStore(); const { S } = st; const bal = useMemo(() => Object.fromEntries(balances(S.J).map((r) => [r.code, r.balance])), [S.J])
  const [open, setOpen] = useState(false); const [ob, setOb] = useState({ date: "", "1000": "", "1010": "", "1200": "", "1500": "", "2000": "" }); const [err, setErr] = useState(null)
  const groups = [...new Set(COA.map((a) => a.group))]
  const where = { 1000: "Billing (cash)", 1010: "Bank transfers, expenses", 1020: "Billing (card)", 1030: "Billing (DuitNow QR)", 1100: "Pending payments", 1200: "Pharmacy stock received / dispensed", 2000: "Stock received on credit, unpaid bills", 2100: "Package sales and balances", 2200: "SST on invoices to non-citizens", 4010: "Consultations", 4020: "Wellness & walk-in treatments", 4030: "Package sessions delivered", 4040: "Medicines dispensed / retail", 4090: "Add payment → other income", 5010: "Pharmacy dispense (at cost)" }
  return (
    <div className="grid gap-5">
      <PageHead icon={ListTree} tone="blue" title="Chart of accounts" sub="Account codes used by every posting. Share with your accountant to map into their software."
        right={<><Button variant="outline" onClick={() => setOpen(true)}><Landmark />Opening balances</Button><Button variant="outline" onClick={() => downloadXLSX([accountantPack(packInputs(S, "1900-01-01", "2999-12-31")).find((s) => s.name === "Chart of Accounts")], "chart-of-accounts.xlsx")}><Download />Excel</Button></>} />
      <Dialog open={open} onOpenChange={setOpen}><DialogContent title="Opening balances (go-live)" description="Enter what the centre has on the day it starts using this system. The other side goes to 3000 Owner's capital. Your accountant can give you these figures.">
        <Label>As at date<Input type="date" value={ob.date} onChange={(e) => setOb({ ...ob, date: e.target.value })} /></Label>
        {["1000", "1010", "1200", "1500", "2000"].map((c) => <Label key={c}>{c} · {acc(c).name}<Input inputMode="decimal" value={ob[c]} onChange={(e) => setOb({ ...ob, [c]: e.target.value })} placeholder="0.00" /></Label>)}
        {err && <p className="text-sm font-semibold text-destructive">{err.en}</p>}
        <Button onClick={async () => { const { date, ...am } = ob; const e = await st.setOpening(am, date || undefined); if (e) setErr(e); else { setErr(null); setOpen(false) } }}><CheckCircle2 />Post opening balances</Button></DialogContent></Dialog>
      <div className="grid gap-4 lg:grid-cols-2">{groups.map((g) => <Card key={g}><CardHeader><CardTitle>{g}</CardTitle></CardHeader><CardContent className="p-0"><Table><tbody>{COA.filter((a) => a.group === g).map((a) => <TR key={a.code}><TD className="w-16 font-mono text-xs">{a.code}</TD><TD><b className="font-semibold">{a.name}</b>{where[a.code] && <div className="text-xs text-muted-foreground">Posted by: {where[a.code]}</div>}</TD><TD className="text-right text-sm whitespace-nowrap">{bal[a.code] ? money(bal[a.code]) : ""}</TD></TR>)}</tbody></Table></CardContent></Card>)}</div>
    </div>)
}
