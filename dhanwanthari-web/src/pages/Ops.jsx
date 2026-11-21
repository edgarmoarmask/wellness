// Packages (wellness therapies, Panchakarma packages with full / partial payment), Pharmacy & stock, Billing.
import { useState } from "react"
import { Flower2, Pill, Receipt, Printer, ShoppingCart, PackagePlus, CheckCircle2, Banknote, CreditCard, QrCode, Gift, AlertTriangle, ArrowRight, PackageCheck, Leaf, Clock, CalendarPlus, Wallet, Lock, BadgeCheck, SplitSquareHorizontal, Landmark } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input, NativeSelect, Label } from "@/components/ui/input"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Table, THead, TR, TH, TD } from "@/components/ui/table"
import { Progress } from "@/components/ui/progress"
import { PageHead, Status, HBars, IconChip, Kpi } from "@/components/kit"
import { useLang } from "@/lib/i18n"
import { useStore, isToday } from "@/lib/store"
import { rm, rm0, num, cn } from "@/lib/utils"
import { PAYMENT_POLICY, PRACTITIONERS, UNITS, ROOMS } from "@data/clinic.js"
import { FORMS } from "@data/inventory.js"
import { ageDays } from "@data/util.js"
import { pkgOf, invoiceFor, unitType, reorderQty, packageState, minDeposit, packageSessionValue, therapies, therapyName } from "@/lib/rules"
import { TherapyMenuCard, PackageCatalog, SessionDialog } from "./Catalog"
import { BillDialog, invoiceBill, packageBill, ReceiptDialog, invoiceReceipt, EmailBadge } from "./BillPrint"
import { applyTax, TAX_CODES, isCitizen } from "@/lib/ledger"
import { payLabel } from "./Front"
import { InventoryCard } from "./Stock"

const PLAN_METHODS = (x) => [["card", CreditCard, x("Card", "Kad")], ["duitnow", QrCode, "DuitNow QR"], ["cash", Banknote, x("Cash", "Tunai")]]
function MethodPick({ method, setMethod }) {
  const { x } = useLang()
  return <div className="grid grid-cols-3 gap-2">{PLAN_METHODS(x).map(([m, I, l]) => <button key={m} type="button" onClick={() => setMethod(m)} aria-pressed={method === m} className={cn("grid cursor-pointer justify-items-center gap-1 rounded-xl border p-3 text-xs font-semibold", method === m ? "border-primary bg-accent text-primary" : "")}><I className="size-5" />{l}</button>)}</div>
}
const LABEL = (x) => ({ promo: x("Promo", "Promosi"), member: x("Member price", "Harga ahli"), special: x("Special offer", "Tawaran istimewa") })

export function Packages() {
  const { x, t, day } = useLang(); const st = useStore(); const { S } = st
  const [sell, setSell] = useState(null); const [pid0, setPid] = useState(""); const pid = S.P.some((p) => p.id === pid0) ? pid0 : S.P[0]?.id || ""; const [method, setMethod] = useState("card"); const [plan, setPlan] = useState("full"); const [amt, setAmt] = useState(""); const [err, setErr] = useState(null)
  const [pay, setPay] = useState(null); const [book, setBook] = useState(null); const [prac, setPrac] = useState("t1"); const [sess, setSess] = useState(null); const [bill, setBill] = useState(null)
  const offers = S.SVC.filter((w) => w.wellness && !w.archived)
  const todayTx = S.Q.filter((v) => v.unit === "tx" && isToday(v.date) && v.status !== "cancelled")
  const rooms = ["R1", "R2", "R3"].map((r) => [r, todayTx.filter((v) => v.room === r).map((v) => { const [h, m] = v.time.split(":").map(Number), a = h + m / 60, mins = ((v.pkSvc ? therapies().find((z) => z.id === v.pkSvc) : therapies().find((z) => z.id === v.svc))?.mins ?? 60) / 60; return [a, a + mins, S.P.find((p) => p.id === v.pid)?.name.split(" ")[0] + " " + v.time] })])
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
  const util = PRACTITIONERS.tx.map((d) => [d.name.replace(" (therapist)", ""), S.Q.filter((v) => v.prac === d.id && v.status === "done" && v.date >= since).length, "#1f7a3f"])
  const recordSession = (k) => { const s0 = packageState(k); if (s0.items.filter((i) => i.left > 0).length > 1) setSess(k.id); else st.useSession(k.id, s0.items.find((i) => i.left > 0)?.svc) }
  const states = S.PK.map((k) => ({ k, ...packageState(k) })), due = states.filter((s) => s.balance > 0)
  const openSell = (id) => { const g = pkgOf(id); setSell(id); setPlan("full"); setAmt(String(minDeposit(g))); setErr(null) }
  const openPay = (k) => { setPay(k.id); setAmt(String(packageState(k).balance)); setMethod("card"); setErr(null) }
  return (
    <div className="grid gap-5">
      <PageHead icon={Flower2} tone="pink" title={x("Wellness & Panchakarma packages", "Pakej kesejahteraan & Panchakarma")} sub={x("Wellness therapies at offer prices, and multi-session packages paid in full or in part.", "Terapi kesejahteraan pada harga tawaran, dan pakej berbilang sesi dibayar penuh atau sebahagian.")} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Gift} tone="herb" label={x("Active packages", "Pakej aktif")} value={states.filter((s) => s.left > 0).length} />
        <Kpi icon={CheckCircle2} tone="cyan" label={x("Paid in full", "Dibayar penuh")} value={states.filter((s) => s.fully && s.left > 0).length} />
        <Kpi icon={Wallet} tone="amber" label={x("Balances to collect", "Baki untuk dikutip")} value={rm(due.reduce((a, s) => a + s.balance, 0))} sub={`${due.length} ${x("clients", "pelanggan")}`} />
        <Kpi icon={AlertTriangle} tone="red" label={x(`Overdue (over ${PAYMENT_POLICY.balanceDueDays} days)`, `Tertunggak (lebih ${PAYMENT_POLICY.balanceDueDays} hari)`)} value={due.filter((s) => s.overdue).length} />
      </div>
      <Card><CardHeader><CardTitle><Leaf className="size-4 text-herb" />{x("Wellness therapies", "Terapi kesejahteraan")}</CardTitle><Badge variant="muted" className="ml-auto">Offers from the therapy menu · edit them there</Badge></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{offers.length === 0 && <p className="col-span-full py-4 text-center text-sm text-muted-foreground">No wellness offers. In the therapy menu, set a therapy's group to "Wellness offer".</p>}{offers.map((w) => (
          <div key={w.id} className="grid content-start gap-2 rounded-2xl border bg-gradient-to-b from-herb-soft/60 to-white p-4">
            <div className="flex items-center justify-between gap-2"><IconChip icon={Leaf} tone="herb" size="sm" />{w.label && <Badge variant="gold">{LABEL(x)[w.label]}</Badge>}</div>
            <b className="leading-snug">{t(w.name)}</b>
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="size-3.5" />{w.mins ? `${w.mins} min` : x("Duration to confirm", "Tempoh belum disahkan")}{w.advance ? ` · ${x("book ahead", "tempah awal")}` : ""}</span>
            <div className="flex items-baseline gap-2"><span className="font-display text-2xl font-bold text-herb">{rm0(w.price)}</span>{w.normal && <><s className="text-sm text-muted-foreground">{rm0(w.normal)}</s><Badge variant="ok">-{Math.round((1 - w.price / w.normal) * 100)}%</Badge></>}</div>
            {w.benefits && <p className="text-xs leading-relaxed text-muted-foreground">{t(w.benefits)}</p>}
            {w.note && <p className="flex gap-1 rounded-lg bg-gold-soft p-2 text-[11px] text-[#7a5a00]"><AlertTriangle className="size-3.5 shrink-0" />{t(w.note)}</p>}
            <Button size="sm" variant="herb" className="mt-auto" onClick={() => setBook(w.id)}><CalendarPlus />{x("Book", "Tempah")}</Button>
          </div>))}</CardContent></Card>
      <TherapyMenuCard />
      <PackageCatalog onSell={openSell} />
      <Card><CardHeader><CardTitle>{x("Client packages", "Pakej pelanggan")}</CardTitle></CardHeader><CardContent className="p-0"><Table>
        <THead><tr><TH>{x("Client", "Pelanggan")}</TH><TH>{x("Package", "Pakej")}</TH><TH>{x("Sessions", "Sesi")}</TH><TH>{x("Payment", "Bayaran")}</TH><TH /></tr></THead>
        <tbody>{states.map(({ k, g, paid, balance, unlocked, left, canUse, overdue, fully, items, expiresOn, expired }) => { const p = S.P.find((z) => z.id === k.pid); return (
          <TR key={k.id}><TD><b>{p.name}</b><div className="text-xs text-muted-foreground">{x("Bought", "Dibeli")} {day(k.sold)}</div></TD><TD>{t(g.name)}{expiresOn && <div className={`text-xs ${expired ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{expired ? "Expired" : "Valid until"} {new Date(expiresOn + "T00:00").toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}</div>}{items.length > 0 && <ul className="mt-1 grid gap-0.5 text-xs text-muted-foreground">{items.map((i) => <li key={i.svc} className="flex justify-between gap-3"><span>{therapyName(i.svc)}</span><span className={i.left ? "" : "line-through"}>{i.used}/{i.n}</span></li>)}</ul>}</TD>
            <TD className="min-w-44"><Progress value={(k.used / g.sessions) * 100} color="var(--herb)" /><span className="text-xs text-muted-foreground">{k.used} / {g.sessions} {x("used", "digunakan")}{!fully && ` · ${unlocked} ${x("paid for", "telah dibayar")}`}</span>
              <div className="mt-1">{left <= 0 ? <Badge variant="ok">{x("Completed", "Selesai")}</Badge> : !canUse ? <Badge variant="danger"><Lock />{x("Locked · collect balance", "Dikunci · kutip baki")}</Badge> : left === 1 ? <Badge variant="warn">{x("1 left · offer renewal", "1 lagi · tawar pembaharuan")}</Badge> : <Badge variant="info">{left} {x("left", "lagi")}</Badge>}</div></TD>
            <TD className="min-w-44">{fully ? <Badge variant="ok"><CheckCircle2 />{x("Paid in full", "Dibayar penuh")} {rm0(g.price)}</Badge> : <><Progress value={(paid / g.price) * 100} color="var(--gold)" /><span className="text-xs"><b>{rm(paid)}</b> {x("paid", "dibayar")} · <b className="text-destructive">{rm(balance)}</b> {x("balance", "baki")}</span>{overdue && <div><Badge variant="danger" className="mt-1">{x("Overdue", "Tertunggak")}</Badge></div>}</>}</TD>
            <TD className="text-right"><div className="flex flex-wrap justify-end gap-1.5">{!fully && <Button size="sm" onClick={() => openPay(k)}><Wallet />{x("Collect balance", "Kutip baki")}</Button>}
              {left > 0 && <Button size="sm" variant="outline" disabled={!canUse} onClick={() => recordSession(k)}><CheckCircle2 />{x("Record session", "Rekod sesi")}</Button>}<Button size="sm" variant="ghost" onClick={() => setBill(packageBill(k, S))}><Printer />Print bill</Button></div></TD></TR>) })}{states.length === 0 && <TR><TD colSpan={5} className="p-8 text-center text-sm text-muted-foreground">No packages sold yet. Choose a package above and press “Sell”.</TD></TR>}</tbody></Table>
        <p className="px-5 pt-3 text-xs text-muted-foreground">{x(`Full payment unlocks every session. Partial payment needs at least ${PAYMENT_POLICY.minDepositPct}% upfront; sessions unlock in line with the amount paid. All package money is held as a deposit and recognised as income session by session.`, `Bayaran penuh membuka semua sesi. Bayaran sebahagian memerlukan sekurang-kurangnya ${PAYMENT_POLICY.minDepositPct}% di awal; sesi dibuka mengikut amaun yang dibayar. Semua wang pakej disimpan sebagai deposit dan diiktiraf sebagai pendapatan mengikut sesi.`)}</p></CardContent></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>{x("Therapy rooms today", "Bilik terapi hari ini")}</CardTitle></CardHeader><CardContent><div className="overflow-x-auto"><div className="min-w-[520px]">
          <div className="grid grid-cols-[150px_repeat(9,1fr)] text-[11px] text-muted-foreground"><span />{[9, 10, 11, 12, 1, 2, 3, 4, 5].map((h, i) => <span key={i}>{h}{i < 3 ? "am" : "pm"}</span>)}</div>
          {rooms.map(([id, slots]) => <div key={id} className="mt-2 grid grid-cols-[150px_1fr] items-center"><span className="truncate pr-2 text-sm font-semibold">{t(ROOMS.find((r) => r.id === id).name)}</span><div className="relative h-9 rounded-lg bg-muted">{slots.map(([a, b, n]) => <span key={n} className="absolute top-1 bottom-1 truncate rounded-md bg-herb px-1.5 text-[11px] leading-7 font-semibold text-white" style={{ left: `${((a - 9) / 9) * 100}%`, width: `${((b - a) / 9) * 100}%` }}>{n}</span>)}</div></div>)}
        </div></div></CardContent></Card>
        <Card><CardHeader><CardTitle>{x("Sessions per therapist, last 30 days", "")}</CardTitle></CardHeader><CardContent><HBars items={util} fmt={(v) => `${v} sessions`} /></CardContent></Card>
      </div>
      <Dialog open={!!sell} onOpenChange={(o) => !o && setSell(null)}>{sell && (() => { const g = pkgOf(sell); return <DialogContent title={`${t(g.name)} · ${rm0(g.price)}`} description={`${g.sessions} ${x("sessions", "sesi")} · ${rm(packageSessionValue(g))} / ${x("session", "sesi")}${g.items?.length ? " · " + g.items.map((i) => `${therapyName(i.svc)} × ${i.n}`).join(", ") : ""}`}>
        <Label>{x("Client", "Pelanggan")}<NativeSelect value={pid} onChange={(e) => setPid(e.target.value)}>{S.P.length === 0 && <option value="">Register a patient first (Patients page)</option>}{S.P.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.id}</option>)}</NativeSelect></Label>
        <div className="grid grid-cols-2 gap-2">{[["full", BadgeCheck, x("Full payment", "Bayaran penuh"), rm0(g.price)], ["partial", SplitSquareHorizontal, x("Partial payment", "Bayaran sebahagian"), `${x("from", "dari")} ${rm0(minDeposit(g))}`]].map(([k, I, l, sub]) => <button key={k} type="button" onClick={() => setPlan(k)} aria-pressed={plan === k} className={cn("grid cursor-pointer justify-items-center gap-1 rounded-xl border p-3 text-sm font-semibold", plan === k ? "border-herb bg-herb-soft text-herb" : "")}><I className="size-5" />{l}<span className="text-[11px] font-normal text-muted-foreground">{sub}</span></button>)}</div>
        {plan === "partial" && <Label>{x("Deposit today (RM)", "Deposit hari ini (RM)")}<Input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /><span className="text-xs font-normal text-muted-foreground">{x("Balance", "Baki")} {rm(Math.max(0, g.price - (Number(amt) || 0)))} · {x("unlocks", "membuka")} {Math.min(g.sessions, Math.floor(((Number(amt) || 0) + 0.005) / packageSessionValue(g)))} {x("sessions now", "sesi sekarang")} · {x("due within", "perlu dibayar dalam")} {PAYMENT_POLICY.balanceDueDays} {x("days", "hari")}</span></Label>}
        <MethodPick method={method} setMethod={setMethod} />
        {err && <p className="text-sm font-semibold text-destructive">{t(err)}</p>}
        <Button variant="herb" onClick={async () => { const e = await st.sellPackage(sell, pid, method, plan, amt); if (e) setErr(e); else setSell(null) }}><CheckCircle2 />{plan === "full" ? `${x("Take full payment", "Terima bayaran penuh")} ${rm0(g.price)}` : `${x("Take deposit", "Terima deposit")} ${rm(Number(amt) || 0)}`}</Button></DialogContent> })()}</Dialog>
      <Dialog open={!!pay} onOpenChange={(o) => !o && setPay(null)}>{pay && (() => { const k = S.PK.find((z) => z.id === pay), s0 = packageState(k), p = S.P.find((z) => z.id === k.pid); return <DialogContent title={x("Collect balance", "Kutip baki")} description={`${p.name} · ${t(s0.g.name)}`}>
        <div className="grid grid-cols-3 gap-2 text-center text-sm">{[[x("Price", "Harga"), rm(s0.g.price)], [x("Paid", "Dibayar"), rm(s0.paid)], [x("Balance", "Baki"), rm(s0.balance)]].map(([l, v]) => <div key={l} className="rounded-xl bg-muted p-2"><div className="text-[11px] text-muted-foreground">{l}</div><b>{v}</b></div>)}</div>
        <div className="grid gap-1 text-xs text-muted-foreground">{k.payments.map((q, i) => <div key={i} className="flex justify-between"><span>{day(q.date)} · {{ card: x("Card", "Kad"), duitnow: "DuitNow QR", cash: x("Cash", "Tunai") }[q.method]}</span><b>{rm(q.amt)}</b></div>)}</div>
        <Label>{x("Amount (RM)", "Amaun (RM)")}<Input inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} /></Label>
        <div className="flex gap-2"><Button size="sm" variant="outline" type="button" onClick={() => setAmt(String(s0.balance))}>{x("Full balance", "Baki penuh")}</Button><Button size="sm" variant="outline" type="button" onClick={() => setAmt(String(Math.round(s0.balance / 2)))}>{x("Half", "Separuh")}</Button></div>
        <MethodPick method={method} setMethod={setMethod} />
        {err && <p className="text-sm font-semibold text-destructive">{t(err)}</p>}
        <Button variant="herb" onClick={async () => { const e = await st.collectBalance(pay, amt, method); if (e) setErr(e); else setPay(null) }}><Wallet />{x("Receive", "Terima")} {rm(Number(amt) || 0)}</Button></DialogContent> })()}</Dialog>
      <Dialog open={!!bill} onOpenChange={(o) => !o && setBill(null)}>{bill && <BillDialog bill={bill} onClose={() => setBill(null)} />}</Dialog>
      <Dialog open={!!sess} onOpenChange={(o) => !o && setSess(null)}>{sess && (() => { const k = S.PK.find((z) => z.id === sess); return <SessionDialog k={k} state={packageState(k)} patient={S.P.find((p) => p.id === k.pid)} onClose={() => setSess(null)} /> })()}</Dialog>
      <Dialog open={!!book} onOpenChange={(o) => !o && setBook(null)}>{book && (() => { const w = S.SVC.find((z) => z.id === book); return <DialogContent title={t(w.name)} description={`${rm0(w.price)}${w.normal ? ` (${x("normal", "biasa")} ${rm0(w.normal)})` : ""} · ${w.mins ? w.mins + " min" : x("duration to confirm", "tempoh belum disahkan")}`}>
        <Label>{x("Client", "Pelanggan")}<NativeSelect value={pid} onChange={(e) => setPid(e.target.value)}>{S.P.length === 0 && <option value="">Register a patient first (Patients page)</option>}{S.P.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.id}</option>)}</NativeSelect></Label>
        <Label>{x("Therapist", "Ahli terapi")}<NativeSelect value={prac} onChange={(e) => setPrac(e.target.value)}>{PRACTITIONERS.tx.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect></Label>
        <Button variant="herb" disabled={!pid} onClick={() => { st.addVisit(pid, "tx", prac, w.id, "walkin"); setBook(null) }}><CalendarPlus />{x("Add to today's therapy queue", "Tambah ke giliran terapi hari ini")}</Button></DialogContent> })()}</Dialog>
    </div>)
}

export function Pharmacy() {
  const { x, t, day } = useLang(); const st = useStore(); const { S } = st
  const pend = S.Q.filter((v) => v.status === "dispense")
  return (
    <div className="grid gap-5">
      <PageHead icon={Pill} tone="gold" title={x("Pharmacy & stock", "Farmasi & stok")} sub={x("Kashayams, arishtams, thailams and lehyams: dispensing, products, batches, expiry, reorders and CSV upload.", "Kashayam, arishtam, thailam dan lehyam: dispens, kelompok, tarikh luput dan pesanan.")} />
      <Card><CardHeader><CardTitle>{x("Waiting to dispense", "Menunggu dispens")}</CardTitle>{pend.length > 0 && <Badge variant="warn">{pend.length}</Badge>}</CardHeader><CardContent className="grid gap-2">
        {pend.length ? pend.map((v) => <div key={v.id} className="flex flex-wrap items-center gap-3 rounded-xl border p-3"><IconChip icon={PackageCheck} tone="gold" /><div className="min-w-0 flex-1 text-sm"><b>{S.P.find((p) => p.id === v.pid).name}</b><div className="text-xs text-muted-foreground">{S.rx[v.id].items.map((it) => `${S.INV.find((z) => z.id === it.id).name} × ${it.q}`).join(", ")}</div></div><Button size="sm" onClick={() => st.dispense(v.id)}><CheckCircle2 />{x("Dispense", "Dispens")}</Button></div>)
          : <p className="text-sm text-muted-foreground">{x("No prescriptions waiting.", "Tiada preskripsi menunggu.")}</p>}</CardContent></Card>
      <InventoryCard />
    </div>)
}

export function Billing({ go, me }) {
  const { x, t, day } = useLang(); const st = useStore(); const { S } = st
  const due = S.Q.filter((v) => v.status === "billing"), [bill, setBill] = useState(null), [rcVid, setRcVid] = useState(null)
  /** pay, then show the receipt for money taken now (cash, card, DuitNow, or medicines on a package visit) */
  const payNow = async (vid, m, total) => { const ok = await st.pay(vid, m); if (ok !== false && m !== "transfer" && (m !== "package" || total > 0)) setRcVid(vid) }
  const rcInv = rcVid && S.INVC.find((i) => i.vid === rcVid)
  const method = { cash: "Cash", card: "Card", duitnow: "DuitNow QR", transfer: "Bank transfer", package: "Package" }
  return (
    <div className="grid gap-5">
      <PageHead icon={Receipt} tone="amber" title={x("Billing", "Bil")} sub={x("Cash, card and DuitNow QR. Package sessions close at RM0 when the session is paid for; package balances are collected under Packages.", "Tunai, kad dan DuitNow QR. Sesi pakej ditutup pada RM0 jika sesi telah dibayar; baki pakej dikutip di Pakej.")} />
      <Card><CardHeader><CardTitle>{x("Ready to bill", "Sedia untuk bil")}</CardTitle>{due.length > 0 && <Badge variant="danger">{due.length}</Badge>}</CardHeader><CardContent className="grid gap-3">
        {due.length === 0 ? <p className="text-sm text-muted-foreground">{x("Nothing to bill right now. Complete a consultation to see it here.", "Tiada bil buat masa ini. Selesaikan konsultasi untuk melihatnya di sini.")}</p> : due.map((v) => {
          const p = S.P.find((z) => z.id === v.pid), rx = S.rx[v.id] || { items: [], svc: unitType(v.unit) === "therapy" ? "abhy" : "cons" }, inv = applyTax(invoiceFor(v, p, rx, S.INV).lines, p, S.SET?.sst, new Date().toISOString().slice(0, 10)), pkgOnly = rx.svc === "session"
          const k = pkgOnly ? S.PK.find((z) => z.id === v.pk) || S.PK.find((z) => z.pid === v.pid && packageState(z).left > 0) : null, ks = k && packageState(k)
          return (
            <div key={v.id} className="grid gap-3 rounded-2xl border p-4 md:grid-cols-[1fr_auto]">
              <div><b>{p.name}</b><div className="text-xs text-muted-foreground">{t(UNITS.find((u) => u.id === v.unit).short)} · {payLabel(p, x, S.PK)}</div>
                <div className="mt-2 grid gap-1 text-sm">{inv.lines.map((l, i) => <div key={i} className="flex gap-2"><span className="flex-1">{l.d}</span><span className="text-[11px] text-muted-foreground" title={TAX_CODES[l.taxCode].label}>{l.taxCode}</span><span>× {l.q}</span><b className="w-24 text-right">{rm(l.net)}</b></div>)}
                  <div className="flex border-t pt-1 text-muted-foreground"><span className="flex-1">Subtotal</span><span className="w-24 text-right">{rm(inv.subtotal)}</span></div>
                  {inv.sst > 0 && <div className="flex text-muted-foreground"><span className="flex-1">Service tax {S.SET?.sst?.rate ?? 6}% (non-citizen)</span><span className="w-24 text-right">{rm(inv.sst)}</span></div>}
                  <div className="flex font-bold"><span className="flex-1">Total</span><span className="w-24 text-right">{rm(inv.total)}</span></div>
                  <div className="text-[11px] text-muted-foreground">{isCitizen(p) ? "Malaysian citizen: SST exempt" : S.SET?.sst?.registered ? "Non-citizen: SST applies (consultation fee exempt)" : "Centre not SST-registered: no SST charged"}</div></div>
                {ks && <div className="mt-2 flex flex-wrap gap-2 text-xs"><Badge variant="herb">{x("Session", "Sesi")} {k.used + 1} / {ks.g.sessions}</Badge>{ks.fully ? <Badge variant="ok">{x("Paid in full", "Dibayar penuh")}</Badge> : <Badge variant={ks.canUse ? "warn" : "danger"}>{x("Balance", "Baki")} {rm(ks.balance)}{!ks.canUse ? ` · ${x("session not paid yet", "sesi belum dibayar")}` : ""}</Badge>}</div>}</div>
              <div className="grid content-center gap-2 md:w-56">
                {pkgOnly && ks && !ks.canUse ? <Button onClick={() => go("packages")}><Wallet />{x("Collect balance first", "Kutip baki dahulu")}</Button>
                  : pkgOnly ? <Button variant="herb" onClick={() => payNow(v.id, "package", inv.total)}><Gift />{inv.total > 0 ? x("Use package + pay medicines", "Guna pakej + bayar ubat") : x("Close (prepaid package)", "Tutup (pakej prabayar)")}</Button>
                  : [["duitnow", QrCode, "DuitNow QR"], ["card", CreditCard, "Card"], ["cash", Banknote, "Cash"], ["transfer", Landmark, "Bank transfer (pending)"]].map(([m, I, l], i) => <Button key={m} variant={i === 0 ? "default" : "outline"} onClick={() => payNow(v.id, m, inv.total)}><I />{l}</Button>)}
              </div>
            </div>) })}</CardContent></Card>
      <Card><CardHeader><CardTitle>{x("Invoices", "Invois")}</CardTitle></CardHeader><CardContent className="p-0"><Table>
        <THead><tr><TH>{x("Invoice", "Invois")}</TH><TH>{x("Patient", "Pesakit")}</TH><TH>{x("Unit", "Unit")}</TH><TH>{x("Method", "Kaedah")}</TH><TH className="text-right">{x("Total", "Jumlah")}</TH><TH>{x("Status", "Status")}</TH><TH /></tr></THead>
        <tbody>{[...S.INVC].reverse().map((i) => <TR key={i.id}><TD><b>{i.id}</b><div className="text-xs text-muted-foreground">{day(i.date)}</div></TD><TD>{S.P.find((p) => p.id === i.pid).name}</TD><TD>{t(UNITS.find((u) => u.id === i.unit).short)}</TD><TD>{method[i.method]}</TD><TD className="text-right">{rm(i.total)}{i.sst > 0 && <div className="text-[11px] text-muted-foreground">incl. SST {rm(i.sst)}</div>}</TD><TD><Badge variant={{ paid: "ok", pending: "warn", failed: "danger", cancelled: "muted" }[i.status ?? "paid"]}>{(i.status ?? "paid")[0].toUpperCase() + (i.status ?? "paid").slice(1)}</Badge>{st.mode === "live" && <div className="mt-1 flex flex-wrap gap-1"><EmailBadge e={i.emails?.invoice} kind="Invoice" /><EmailBadge e={i.emails?.receipt} kind="Receipt" /></div>}</TD><TD className="text-right"><div className="flex justify-end gap-1">{(i.status ?? "paid") === "paid" && i.total > 0 && <Button size="sm" variant="ghost" onClick={() => setRcVid(i.vid)}><Receipt />Receipt</Button>}<Button size="sm" variant="outline" onClick={() => setBill(invoiceBill(i, S))}><Printer />Print bill</Button></div></TD></TR>)}{S.INVC.length === 0 && <TR><TD colSpan={7} className="p-8 text-center text-sm text-muted-foreground">No invoices yet.</TD></TR>}</tbody></Table></CardContent></Card>
      <Dialog open={!!bill} onOpenChange={(o) => !o && setBill(null)}>{bill && <BillDialog bill={bill} onClose={() => setBill(null)} />}</Dialog>
      <Dialog open={!!rcInv} onOpenChange={(o) => !o && setRcVid(null)}>{rcInv && <ReceiptDialog receipt={invoiceReceipt(rcInv, S, me)} onClose={() => setRcVid(null)} onBill={() => { setRcVid(null); setBill(invoiceBill(rcInv, S)) }}
        email={st.mode === "live" ? rcInv.emails?.receipt ?? null : undefined} onEmail={st.mode === "live" ? () => st.emailBill(rcInv.id, "receipt") : undefined} />}</Dialog>
    </div>)
}
