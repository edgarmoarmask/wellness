// Bill preview + print. Invoices (Billing page, patient record) and package sales (client packages).
import { useMemo } from "react"
import { Mail, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DialogContent } from "@/components/ui/dialog"
import { billHtml, receiptHtml, printBill } from "@/lib/bill"
import { packageState } from "@/lib/rules"

const METHOD = { cash: "cash", card: "card", duitnow: "DuitNow QR", transfer: "bank transfer", package: "prepaid package" }
const ageAt = (dob, on) => { if (!dob) return null; const b = new Date(dob), n = new Date(on); let a = n.getFullYear() - b.getFullYear(); if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--; return a }
const dmy = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}/${m}/${y}` }
const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

/** invoice (S.INVC row) → bill */
export function invoiceBill(inv, S) {
  const p = S.P.find((z) => z.id === inv.pid) ?? { name: "" }, sst = S.SET?.sst ?? {}
  const lines = (inv.lines ?? []).map((l) => ({ d: l.q > 1 ? `${l.d} × ${l.q}` : l.d, note: l.q > 1 ? `RM ${Number(l.p).toFixed(2)} each` : "", amt: r2(l.q * l.p) }))
  const status = { paid: `Paid by ${METHOD[inv.method] ?? inv.method}`, pending: `Payment pending (${METHOD[inv.method] ?? inv.method})`, failed: "Payment failed", cancelled: "Cancelled / refunded" }[inv.status] ?? ""
  return { no: inv.id, date: inv.date, patient: p.name, age: ageAt(p.dob, inv.date), lines, subtotal: inv.subtotal, sst: inv.sst, sstRate: sst.rate ?? 6, sstReg: sst.regNo, total: inv.total,
    payment: inv.method === "package" && inv.total === 0 ? "Prepaid package session" : status }
}

/** client package (S.PK row) → bill with paid to date and balance */
export function packageBill(k, S) {
  const st = packageState(k), g = st.g, p = S.P.find((z) => z.id === k.pid) ?? { name: "" }, sst = S.SET?.sst ?? {}
  const tx = S.TX.filter((t) => t.ref === k.id && t.type === "in" && t.status !== "cancelled" && t.status !== "failed").sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const taxed = tx.some((t) => t.tax > 0), sstFull = taxed ? r2(g.price * (sst.rate ?? 6) / 100) : 0, total = r2(g.price + sstFull)
  const paid = r2(tx.reduce((a, t) => a + (t.amount ?? t.net + t.tax), 0))
  const note = [`${g.sessions} sessions`, g.duration, st.expiresOn ? `valid until ${dmy(st.expiresOn)}` : null].filter(Boolean).join(" · ")
  return { no: tx[0]?.no ?? k.id, date: tx[tx.length - 1]?.date ?? k.sold, patient: p.name, age: ageAt(p.dob, k.sold), lines: [{ d: `${g.code ? g.code + " · " : ""}${g.name.en}`, note, amt: g.price }],
    subtotal: g.price, sst: sstFull, sstRate: sst.rate ?? 6, sstReg: sst.regNo, total, paid, balance: r2(Math.max(0, total - paid)),
    payment: tx.length ? "Payments: " + tx.map((t) => `${dmy(t.date)} RM ${Number(t.amount).toFixed(2)} (${METHOD[t.method] ?? t.method}${t.status === "pending" ? ", pending" : ""})`).join(" · ") : "" }
}

export function BillDialog({ bill, onClose }) {
  const html = useMemo(() => billHtml(bill), [bill])
  return (
    <DialogContent className="max-w-4xl" title={`Bill ${bill.no}`} description={`${bill.patient} · RM ${Number(bill.total).toFixed(2)} · A4. In the print window choose your printer, or "Save as PDF".`}>
      <iframe title="Bill preview" srcDoc={html} className="h-[68vh] w-full rounded-xl border bg-[#eef0ec]" />
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Close</Button><Button onClick={() => printBill(html)}><Printer />Print bill</Button></div>
    </DialogContent>)
}

const METHOD_LABEL = { cash: "Cash", card: "Card", duitnow: "DuitNow QR", transfer: "Bank transfer", package: "Prepaid package" }

/** paid invoice (S.INVC row) → official receipt; me = the signed-in user receiving the money */
export function invoiceReceipt(inv, S, me) {
  const b = invoiceBill(inv, S), tx = S.TX.find((t) => t.id === inv.txId || t.no === inv.txId)
  const at = tx?.at ? new Date(tx.at) : null
  const method = inv.method === "package" ? `Prepaid package${tx ? ` + ${METHOD_LABEL[tx.method] ?? tx.method} for medicines` : ""}` : METHOD_LABEL[inv.method] ?? inv.method
  return { ...b, no: tx?.no ?? inv.id, billNo: inv.id, date: tx?.date ?? inv.date, time: at ? at.toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit" }) : "",
    method, total: inv.total, receivedBy: me?.name }
}

/** badge for the latest email attempt of an invoice / receipt (live mode) */
export function EmailBadge({ e, kind }) {
  if (!e) return null
  const [label, cls] = { sent: ["Emailed", "bg-[#dcfce7] text-[#166534]"], skipped: ["No email", "bg-muted text-muted-foreground"], logged: ["Email not set up", "bg-muted text-muted-foreground"],
    failed: ["Email failed", "bg-[#fee2e2] text-[#991b1b]"], not_configured: ["Email not set up", "bg-[#fee2e2] text-[#991b1b]"] }[e.status] ?? [e.status, "bg-muted"]
  return <span title={`${kind}: ${e.error ?? e.to ?? ""}`} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}><Mail className="size-3" />{label}</span>
}

export function ReceiptDialog({ receipt, onClose, onBill, email, onEmail }) {
  const html = useMemo(() => receiptHtml(receipt), [receipt])
  return (
    <DialogContent className="max-w-3xl" title={`Payment received · Receipt ${receipt.no}`} description={`${receipt.patient} · RM ${Number(receipt.total).toFixed(2)} · ${receipt.method}. A5 receipt; in the print window choose your printer, or "Save as PDF".`}>
      <iframe title="Receipt preview" srcDoc={html} className="h-[66vh] w-full rounded-xl border bg-[#eef0ec]" />
      <div className="flex flex-wrap items-center justify-end gap-2">{email !== undefined && <span className="mr-auto text-xs text-muted-foreground">{email ? <>Email to patient: <EmailBadge e={email} kind="Receipt" /> {email.to}</> : "Emailing the receipt to the patient…"}</span>}
        <Button variant="outline" onClick={onClose}>Done</Button>{onEmail && <Button variant="outline" onClick={onEmail}><Mail />Email receipt</Button>}{onBill && <Button variant="outline" onClick={onBill}>Full bill (A4)</Button>}<Button onClick={() => printBill(html)}><Printer />Print receipt</Button></div>
    </DialogContent>)
}
