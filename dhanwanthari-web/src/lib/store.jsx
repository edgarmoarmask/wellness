// App state + actions (saved in this browser's localStorage for the demo).
// Each action mirrors an endpoint of the clinic server (dhanwanthari-server, FastAPI; see its docs/API.md). Starts with NO patient data.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import { PATIENTS } from "@data/patients.js"
import { INVENTORY } from "@data/inventory.js"
import { QUEUE, CLIENT_PACKAGES, INVOICES, JOURNAL, TRANSACTIONS } from "@data/today.js"
import { UNITS, SERVICES, PACKAGES, WELLNESS } from "@data/clinic.js"
import { A, acc, cashAcc, incomeAcc, applyTax, taxCodeFor, DEFAULT_SST } from "./ledger.js"
import { iso, TODAY } from "@data/util.js"
import { checkProduct, productPostings } from "./products.js"
import { invoiceFor, safetyCheck, reorderQty, pkgOf, packageSessionValue, unitType, packageState, checkPayment, sessionTherapy, therapyName } from "./rules.js"
import { setCatalog, checkTherapy, checkPackage, nextId } from "./catalog.js"
import { checkUser, checkPassword, demoHash } from "./users.js"
import { DEFAULT_ATT, LEAVE_TYPES, checkSettings, checkTimes, dayStatus, summary as attSummary, daysBetween } from "./attendance.js"
import { DEMO_USER_SEED } from "@data/users.js"

const KEY = "dvc.v4"
/** next free m-number (m1, m2 … never reused, archived items included) */
const nextProductId = (inv) => "m" + (Math.max(0, ...inv.map((i) => Number(String(i.id).replace(/^m/, "")) || 0)) + 1)
/** therapy menu + packages as data the clinic edits (wellness offers carry their poster benefits / notes) */
const seedCatalog = () => ({
  SVC: SERVICES.therapy.map((x) => { const w = WELLNESS.find((z) => z.id === x.id); return w ? { ...x, benefits: w.benefits, advance: !!w.advance, note: w.check } : { ...x } }),
  PKG: PACKAGES.map((g) => ({ ...g, items: [...g.items] })),
})
const seed = () => structuredClone({ ...seedCatalog(), USERS: DEMO_USER_SEED, ATT: [], ATTSET: DEFAULT_ATT, P: PATIENTS, Q: QUEUE, INV: INVENTORY, PK: CLIENT_PACKAGES, INVC: INVOICES, J: JOURNAL, TX: TRANSACTIONS, SET: { sst: DEFAULT_SST }, rx: {}, seq: 1, pseq: 1, tseq: 1, jseq: 1 })
const load = () => { try { const s = JSON.parse(localStorage.getItem(KEY)); if (s?.P && Array.isArray(s.Q)) { const o = s.SVC && s.PKG ? s : { ...structuredClone(seedCatalog()), ...s }; for (const x of o.SVC) if (x.group === "Add-on") x.group = "Walk-in treatment"; if (!o.USERS) o.USERS = structuredClone(DEMO_USER_SEED); if (!o.ATT) o.ATT = []; if (!o.ATTSET) o.ATTSET = { ...DEFAULT_ATT }; for (const g of seedCatalog().PKG) if (!o.PKG.some((x) => x.id === g.id)) o.PKG.push(structuredClone(g)); return o } } catch {} return seed() }
const L = (en, ms) => ({ en, ms })
const now = () => new Date().toISOString()
/** appointment day + time check (same rules on the server): today up to a year ahead, not a time already passed */
export function checkAppointment(date, time) {
  const today = iso(new Date())
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return "Choose the appointment day."
  if (!/^\d{2}:\d{2}$/.test(time || "")) return "Choose the appointment time."
  if (date < today) return "Appointment date can't be in the past"
  if ((new Date(date) - new Date(today)) / 864e5 > 365) return "Appointments can be booked up to a year ahead"
  if (date === today && time < hhmm()) return "That time today has already passed"
  return null
}
const hhmm = () => { const d = new Date(); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") }
export const CASH_ACCOUNTS = [A.cash, A.bank, A.card, A.duitnow]

const Ctx = createContext(null)
/** Patient form rules (same in both modes; the API checks them again). */
export function checkPatient(data, id, P) {
  const d = { ...data, name: (data.name || "").trim(), idNo: (data.idNo || "").trim().toUpperCase(), phone: (data.phone || "").trim() }
  if (!d.name) return { error: "Enter the patient's full name." }
  if (!d.phone) return { error: "Enter a phone number." }
  if (!d.idNo) return { error: "Enter the MyKad or passport number." }
  if (d.idType === "mykad" && !/^\d{6}-?\d{2}-?\d{4}$/.test(d.idNo)) return { error: "MyKad number should look like 900101-14-5678." }
  if (P.some((q) => q.idNo === d.idNo && q.id !== id)) return { error: "A patient with this ID number is already registered." }
  const v = checkVitals(d); if (v.error) return v; Object.assign(d, v.d)
  if (!d.pdpaConsent) return { error: "Tick PDPA consent before saving." }
  return { d }
}
/** height (cm), weight (kg), blood pressure ("120/80") — all optional. Same rules on the server (app/routers/clinic.py). */
export function checkVitals(x) {
  const n = (v) => (v === "" || v === null || v === undefined ? null : Number(String(v).replace(",", ".")))
  const h = n(x.heightCm), w = n(x.weightKg), bp = String(x.bp ?? "").replace(/\s+/g, "")
  if (h !== null && !(h >= 30 && h <= 250)) return { error: "Height should be in cm, between 30 and 250." }
  if (w !== null && !(w >= 1 && w <= 350)) return { error: "Weight should be in kg, between 1 and 350." }
  let bpOut = ""
  if (bp) {
    const m = bp.match(/^(\d{2,3})\/(\d{2,3})$/)
    if (!m) return { error: "Blood pressure should look like 120/80." }
    const sys = +m[1], dia = +m[2]
    if (sys < 60 || sys > 260 || dia < 30 || dia > 160 || sys <= dia) return { error: "Blood pressure looks wrong. Enter it as systolic/diastolic, e.g. 120/80." }
    bpOut = `${sys}/${dia}`
  }
  return { d: { heightCm: h === null ? null : Math.round(h * 10) / 10, weightKg: w === null ? null : Math.round(w * 10) / 10, bp: bpOut } }
}
/** BMI from cm / kg, 1 decimal; null when either is missing */
export const bmi = (h, w) => (h && w ? Math.round((w / (h / 100) ** 2) * 10) / 10 : null)
export const bmiLabel = (b) => (b === null ? "" : b < 18.5 ? "underweight" : b < 25 ? "healthy range" : b < 30 ? "overweight" : "obese range")
/**
 * Two modes, decided at start from ./config.json ({ "api": "/api", "mode": "auto" | "live" | "demo" }):
 *  - live: every action calls the clinic server (dhanwanthari-server) and then reloads /api/state. Data is shared by all devices.
 *  - demo: everything is kept in this browser (localStorage). Used when the API is not reachable and mode is "auto".
 */
export function StoreProvider({ children }) {
  const [S, setS] = useState(load)
  const [toast, setToast] = useState(null)
  const [mode, setMode] = useState("checking")          // checking | live | demo | offline
  const [auth, setAuth] = useState(() => { try { return JSON.parse(sessionStorage.getItem("dvc.auth")) } catch { return null } })
  const ref = useRef(S); ref.current = S
  const cfg = useRef({ api: "/api", mode: "auto" }), authRef = useRef(auth); authRef.current = auth
  useEffect(() => { if (mode === "demo") try { localStorage.setItem(KEY, JSON.stringify(S)) } catch {} }, [S, mode])
  useEffect(() => {
    let dead = false
    ;(async () => {
      try { const r = await fetch("./config.json", { cache: "no-store" }); if (r.ok) cfg.current = { ...cfg.current, ...(await r.json()) } } catch {}
      if (cfg.current.mode === "demo") return !dead && setMode("demo")
      try { const r = await fetch(cfg.current.api + "/health", { cache: "no-store" }); const j = r.ok && (await r.json()); if (j?.ok) return !dead && setMode("live") } catch {}
      if (!dead) setMode(cfg.current.mode === "live" ? "offline" : "demo")
    })()
    return () => { dead = true }
  }, [])
  const api = useMemo(() => {
    const up = (fn) => setS((p) => { const n = structuredClone(p); fn(n); return n })
    let tid
    const say = (msg) => { clearTimeout(tid); setToast({ msg }); tid = setTimeout(() => setToast(null), 2600) }
    const r2 = (x) => Math.round(x * 100) / 100
    /** one journal entry: debit `dr`, credit `cr` (account codes) */
    const post = (n, d, dr, cr, amt, ref) => { if (amt > 0.004) n.J.unshift({ id: "J" + String(n.jseq++).padStart(6, "0"), date: iso(new Date()), ref: ref ?? "", d, dr, cr, amt: r2(amt) }) }
    const txNo = (n, type) => (type === "in" ? "RC-" : "PV-") + String(n.tseq++).padStart(5, "0")
    /**
     * Money in. parts = [{ acc: income/deposit code, net, tax }]. status paid → Dr cash/bank; pending → Dr 1100 receivable.
     * Returns the transaction (kept with its parts so it can be confirmed, failed or cancelled later).
     */
    const moneyIn = (n, { d, parts, method, status = "paid", ref = "", pid, taxCode = "NR" }) => {
      const no = txNo(n, "in"), debit = status === "paid" ? cashAcc(method) : A.ar
      for (const pt of parts) { post(n, d, debit, pt.acc, pt.net, ref || no); post(n, `${d} · SST`, debit, A.sst, pt.tax, ref || no) }
      const net = r2(parts.reduce((a, x) => a + x.net, 0)), tax = r2(parts.reduce((a, x) => a + x.tax, 0))
      const main = [...parts].sort((a, b) => b.net - a.net)[0]?.acc ?? A.other
      const t = { id: no, no, date: iso(new Date()), at: new Date().toISOString(), type: "in", d, acc: main, method, ref, pid, status, parts, net, tax, taxCode, amount: r2(net + tax) }
      n.TX.unshift(t); return t
    }
    /** Money out (expense or supplier payment). pending = bill received, not yet paid (Cr 2000 payable). */
    const moneyOut = (n, { d, code, amount, method, status = "paid", ref = "" }) => {
      const no = txNo(n, "out")
      if (code === A.ap) post(n, d, A.ap, cashAcc(method), amount, no)            // paying a supplier bill
      else post(n, d, code, status === "paid" ? cashAcc(method) : A.ap, amount, no)
      const t = { id: no, no, date: iso(new Date()), type: "out", d, acc: code, method, ref, status, net: r2(amount), tax: 0, taxCode: "", amount: r2(amount) }
      n.TX.unshift(t); return t
    }
    const sstOf = (n) => n.SET?.sst ?? DEFAULT_SST
    const nextInv = (n) => "INV-" + new Date().getFullYear() + "-" + String(n.seq++).padStart(5, "0")
    const v = (n, id) => n.Q.find((q) => q.id === id)
    const p = (n, id) => n.P.find((q) => q.id === id)
    const rxOf = (n, vis) => (n.rx[vis.id] ??= { items: [], dx: "", dosha: "", note: "", mc: 0, svc: vis.svc || (unitType(vis.unit) === "therapy" ? "abhy" : "cons") })
    return {
      say,
      /** clears EVERYTHING entered in this browser (demo only) */
      reset: () => { setS(seed()); say(L("All data cleared", "")) },
      // ----- patients -----
      /** returns { id } or { error } — name, phone and ID number are required; ID number must be unique */
      savePatient: (data, id) => {
        const { d, error } = checkPatient(data, id, ref.current.P); if (error) return { error }
        const newId = id ?? "DV-" + String(ref.current.pseq).padStart(5, "0")
        up((n) => {
          if (id) Object.assign(p(n, id), d, { updated: now() })
          else { n.pseq++; n.P.unshift({ ...d, id: newId, created: now() }) }
        })
        say(id ? L("Patient record updated", "") : L(`Patient registered · ${newId}`, ""))
        return { id: newId }
      },
      // ----- queue -----
      /** kind: walkin (arrived now, waiting) | appt (booked for a time today) */
      /** svc "session:<therapyId>" (or "session") books a prepaid package session for that therapy */
      addVisit: (pid, unit, prac, svc, kind = "walkin", time, date) => {
        const day = kind === "appt" ? date || iso(new Date()) : iso(new Date())
        if (kind === "appt") { const e = checkAppointment(day, time); if (e) { say(L(e, "")); return false } }
        const [sv, pkSvc] = String(svc ?? "").startsWith("session") ? ["session", svc.split(":")[1] || undefined] : [svc, undefined]
        let pk
        if (sv === "session") {
          const open = ref.current.PK.filter((k) => k.pid === pid && packageState(k).left > 0 && !packageState(k).expired)
          const k = open.find((z) => !sessionTherapy(z, pkSvc).error) ?? null
          if (!k) { say(open.length ? sessionTherapy(open[0], pkSvc).error : L("This patient has no active package.", "")); return false }
          pk = k.id
        }
        up((n) => {
          n.Q.push({ id: "v" + Date.now(), date: day, pid, unit, time: time || hhmm(), kind, status: kind === "walkin" ? "waiting" : "booked", checkedInAt: kind === "walkin" ? now() : null, prac, room: unit === "tx" ? "R1" : "C1", svc: unit === "tx" ? sv : undefined, pk, pkSvc })
          say(kind === "walkin" ? L("Added to the queue", "") : L("Appointment booked", ""))
        })
        return true
      },
      checkIn: (id) => up((n) => { const x = v(n, id); x.status = "waiting"; x.checkedInAt = now(); say(L(`${p(n, x.pid).name} checked in`, "")) }),
      cancelVisit: (id) => up((n) => { v(n, id).status = "cancelled"; say(L("Visit cancelled", "")) }),
      /** only appointments not yet checked in */
      deleteVisit: (id) => {
        const x = ref.current.Q.find((z) => z.id === id); if (!x) return "Appointment not found."
        if (x.status !== "booked") return "Only appointments that haven't been checked in can be deleted."
        up((n) => { n.Q = n.Q.filter((z) => z.id !== id) }); say(L("Appointment deleted", "")); return null
      },
      /** removes not-started entries (booked / waiting) for the day; hides finished ones (they stay in patient records) */
      clearQueue: (unit, date = iso(new Date())) => {
        const day = (z) => z.unit === unit && z.date === date && z.status !== "cancelled", Q0 = ref.current.Q.filter(day)
        const removed = Q0.filter((z) => z.status === "booked" || z.status === "waiting").length, hidden = Q0.filter((z) => z.status === "done" && !z.cleared).length, kept = Q0.filter((z) => !["booked", "waiting", "done"].includes(z.status)).length
        up((n) => { n.Q = n.Q.filter((z) => !(day(z) && (z.status === "booked" || z.status === "waiting"))); for (const z of n.Q) if (day(z) && z.status === "done") z.cleared = true })
        say(L(`Queue cleared · ${removed} removed${hidden ? `, ${hidden} finished hidden` : ""}${kept ? ` · ${kept} still in progress` : ""}`, "")); return { removed, hidden, kept }
      },
      startVisit: (id) => up((n) => { const y = v(n, id); y.status = "consult"; y.startedAt = now(); rxOf(n, y) }),
      // ----- consultation -----
      setRx: (vid, patch) => up((n) => Object.assign(rxOf(n, v(n, vid)), patch)),
      addRx: (vid, itemId, qty) => {
        const s = ref.current, x = s.Q.find((q) => q.id === vid), item = s.INV.find((z) => z.id === itemId), pt = s.P.find((q) => q.id === x.pid)
        const r = safetyCheck(item, qty, pt)
        if (r.block) return r
        up((n) => rxOf(n, v(n, vid)).items.push({ id: itemId, q: qty, warn: r.warn?.en }))
        return r
      },
      delRx: (vid, i) => up((n) => rxOf(n, v(n, vid)).items.splice(i, 1)),
      complete: (vid) => {
        const x = ref.current.Q.find((q) => q.id === vid), rx = ref.current.rx[vid] || {}
        if (unitType(x.unit) === "consult" && !rx.dx) return L("Choose a diagnosis before completing.", "")
        up((n) => { const y = v(n, vid); y.status = (n.rx[vid]?.items.length ?? 0) ? "dispense" : "billing"; y.completedAt = now() })
        say(L("Visit completed", "")); return null
      },
      // ----- pharmacy -----
      dispense: (vid) => up((n) => { const y = v(n, vid); for (const it of n.rx[vid].items) { const m = n.INV.find((z) => z.id === it.id); m.stock -= it.q; post(n, `Dispensed · ${m.name} × ${it.q}`, A.cogs, A.inventory, it.q * (m.cost ?? m.price * 0.55), vid) } y.status = "billing"; say(L("Dispensed. Stock updated.", "")) }),
      /** stock received from supplier on credit: Dr 1200 inventory, Cr 2000 payable (pay it via Add expense → Pay supplier bill) */
      // ----- products (pharmacy & stock) -----
      /** add (no id) or edit a product. Stock / cost changes post to the books. Returns { id } or { error }. */
      saveProduct: (data, id) => {
        const s0 = ref.current, before = id ? s0.INV.find((z) => z.id === id) : null
        const { d, error } = checkProduct(data, { id, all: s0.INV }); if (error) return { error }
        const newId = id ?? nextProductId(s0.INV)
        up((n) => {
          if (id) { const i = n.INV.find((z) => z.id === id); for (const e of productPostings(before, { ...before, ...d })) post(n, e.d, e.dr, e.cr, e.amt, id); Object.assign(i, d, { contra: d.contra, base: d.base }) }
          else { n.INV.push({ ...d, id: newId }); for (const e of productPostings(null, d)) post(n, e.d, e.dr, e.cr, e.amt, newId) }
        })
        say(id ? L("Product updated", "") : L(`Product added · ${d.name}`, "")); return { id: newId }
      },
      /** delete = archive: past prescriptions and invoices keep the name; stock left is written off (Dr 5030, Cr 1200) */
      deleteProduct: (id) => {
        const s0 = ref.current, i = s0.INV.find((z) => z.id === id); if (!i) return L("Product not found.", "")
        const open = s0.Q.some((q) => ["consult", "dispense"].includes(q.status) && (s0.rx[q.id]?.items ?? []).some((it) => it.id === id))
        if (open) return L(`${i.name} is on a prescription waiting to be dispensed. Dispense or remove it first.`, "")
        up((n) => { const x = n.INV.find((z) => z.id === id); for (const e of productPostings(x, null)) post(n, e.d, e.dr, e.cr, e.amt, id); x.stock = 0; x.archived = true })
        say(L(`Deleted · ${i.name}`, "")); return null
      },
      /** rows from readProductCsv (valid, changed rows only) */
      importProducts: (rows) => {
        const added = rows.filter((r) => !r.id).length, updated = rows.length - added
        up((n) => { for (const r of rows) {
          if (r.id) { const i = n.INV.find((z) => z.id === r.id); for (const e of productPostings(i, { ...i, ...r.d })) post(n, e.d, e.dr, e.cr, e.amt, r.id); Object.assign(i, r.d) }
          else { const id = nextProductId(n.INV); n.INV.push({ ...r.d, id }); for (const e of productPostings(null, r.d)) post(n, e.d, e.dr, e.cr, e.amt, id) }
        } })
        say(L(`Import done · ${added} added, ${updated} updated`, "")); return { added, updated }
      },
      reorder: (itemId) => up((n) => { const i = n.INV.find((z) => z.id === itemId), q = reorderQty(i), cost = q * (i.cost ?? i.price * 0.55); i.stock += q; post(n, `Stock received · ${i.name} × ${q}`, A.inventory, A.ap, cost, "PO-" + itemId); say(L(`Stock received: ${q} × ${i.name}. Supplier bill ${r2(cost).toFixed(2)} added to payables.`, "")) }),
      // ----- billing -----
      /**
       * method: cash | card | duitnow | transfer (bank transfer = PENDING until confirmed in Accounting → Transactions) | package.
       * SST is applied per line (see ledger.js). A package visit uses one paid session; medicines are paid with extrasMethod.
       */
      pay: (vid, method, extrasMethod = "duitnow") => {
        const s0 = ref.current, x0 = s0.Q.find((q) => q.id === vid)
        if (method === "package") {
          const k0 = s0.PK.find((z) => z.id === x0.pk) || s0.PK.find((z) => z.pid === x0.pid && packageState(z).left > 0)
          if (k0 && packageState(k0).expired) { say(L(`This package expired on ${packageState(k0).expiresOn}. Sessions can't be used after the validity period.`, "")); return false }
          if (!k0 || !packageState(k0).canUse) { say(L("No paid session left on this package. Collect the balance first.", "")); return false }
          const ch = sessionTherapy(k0, x0.pkSvc); if (ch.error) { say(ch.error); return false }
        }
        up((n) => {
          const y = v(n, vid), pt = p(n, y.pid), base = invoiceFor(y, pt, rxOf(n, y), n.INV), inv = applyTax(base.lines, pt, sstOf(n), iso(new Date())), id = nextInv(n)
          const parts = (kinds) => kinds.map((k) => { const ls = inv.lines.filter((l) => l.kind === k); return { acc: incomeAcc(k), net: r2(ls.reduce((a, l) => a + l.net, 0)), tax: r2(ls.reduce((a, l) => a + l.tax, 0)), taxCode: ls[0]?.taxCode ?? "NR" } }).filter((x) => x.net > 0)
          const code = inv.lines.find((l) => l.tax > 0)?.taxCode ?? inv.lines.find((l) => l.net > 0)?.taxCode ?? "NR"
          let status = "paid", txId = null
          if (method === "package") {
            const k = n.PK.find((z) => z.id === y.pk) || n.PK.find((z) => z.pid === y.pid && packageState(z).left > 0)
            const ch = sessionTherapy(k, y.pkSvc)
            k.used++; (k.log ??= []).push(iso(new Date())); y.pk = k.id; if (ch.svc) { k.usage = { ...k.usage, [ch.svc]: (k.usage?.[ch.svc] ?? 0) + 1 }; y.pkSvc = ch.svc }
            post(n, `${id} · package session${ch.svc ? ` · ${therapyName(ch.svc)}` : ""} (${pt.name})`, A.deposits, A.pkgIncome, packageState(k).per, id)
            const meds = parts(["med"]); if (meds.length) txId = moneyIn(n, { d: `${id} · medicines`, parts: meds, method: extrasMethod, ref: id, pid: y.pid, taxCode: code }).id
          } else {
            status = method === "transfer" ? "pending" : "paid"
            txId = moneyIn(n, { d: `${id} · ${pt.name}`, parts: parts(["cons", "tx", "med"]), method, status, ref: id, pid: y.pid, taxCode: code }).id
          }
          n.INVC.push({ id, date: iso(new Date()), vid, pid: y.pid, unit: y.unit, lines: inv.lines, subtotal: inv.subtotal, sst: inv.sst, total: inv.total, method, status, txId })
          y.status = "done"; y.invoice = id
          say(status === "pending" ? L(`Invoice ${id} issued · waiting for bank transfer`, "") : L(`Paid · receipt ${id}`, ""))
        })
        return true
      },
      // ----- packages -----
      sellPackage: (pkgId, pid, method, plan = "full", amount) => {
        const g = pkgOf(pkgId), amt = plan === "full" ? g.price : Number(amount), err = checkPayment(g, 0, amt, true)
        if (!pid) return L("Choose a patient.", "")
        if (!g || g.archived) return L("This package is no longer sold.", "")
        if (err) return err
        up((n) => {
          n.PK.unshift({ id: "k" + Date.now(), pid, pkg: pkgId, used: 0, sold: iso(new Date()), plan, payments: [{ date: iso(new Date()), amt, method }], log: [], usage: {},
            terms: { name: g.name, price: g.price, sessions: g.sessions, items: structuredClone(g.items ?? []), validityMonths: g.validityMonths ?? null } })
          const pt = p(n, pid), code = taxCodeFor("pkg", pt, sstOf(n), iso(new Date())), tax = code === "SV6" ? r2((amt * sstOf(n).rate) / 100) : 0
          moneyIn(n, { d: `Package ${plan === "full" ? "sale (paid in full)" : "deposit"} · ${g.name.en} (${pt.name})`, parts: [{ acc: A.deposits, net: amt, tax, taxCode: code }], method, pid, taxCode: code, ref: n.PK[0].id })
        })
        say(plan === "full" ? L("Package sold and paid in full. All sessions unlocked.", "") : L("Deposit received. Sessions unlock as the balance is paid.", ""))
        return null
      },
      collectBalance: (kid, amount, method) => {
        const k0 = ref.current.PK.find((z) => z.id === kid), st0 = packageState(k0), amt = Number(amount), err = checkPayment(st0.g, st0.paid, amt, false)
        if (err) return err
        up((n) => { const k = n.PK.find((z) => z.id === kid); k.payments.push({ date: iso(new Date()), amt, method }); const pt = p(n, k.pid), code = taxCodeFor("pkg", pt, sstOf(n), iso(new Date())); moneyIn(n, { d: `Package balance · ${packageState(k).g.name.en} (${pt.name})`, parts: [{ acc: A.deposits, net: amt, tax: code === "SV6" ? r2((amt * sstOf(n).rate) / 100) : 0, taxCode: code }], method, pid: k.pid, taxCode: code, ref: k.id }) })
        say(amt >= st0.balance - 0.001 ? L("Balance cleared. Package fully paid.", "") : L("Part payment received.", ""))
        return null
      },
      /** svc = which therapy of the package was done (needed when the package lists therapies) */
      useSession: (kid, svc) => {
        const k0 = ref.current.PK.find((z) => z.id === kid), s0 = packageState(k0)
        if (s0.expired) { say(L(`This package expired on ${s0.expiresOn}. Sessions can't be used after the validity period.`, "")); return false }
        if (!s0.canUse) { say(s0.left <= 0 ? L("All sessions used.", "") : L("No paid session left. Collect the balance to continue.", "")); return false }
        const ch = sessionTherapy(k0, svc); if (ch.error) { say(ch.error); return false }
        up((n) => { const k = n.PK.find((z) => z.id === kid); k.used++; (k.log ??= []).push(iso(new Date())); if (ch.svc) k.usage = { ...k.usage, [ch.svc]: (k.usage?.[ch.svc] ?? 0) + 1 }
          post(n, `Package session${ch.svc ? ` · ${therapyName(ch.svc)}` : ""} · ${p(n, k.pid).name}`, A.deposits, A.pkgIncome, s0.per, k.id) })
        say(L("Session recorded", "")); return true
      },
      emailBill: async () => { const m = "Emails are sent by the clinic server. In demo mode nothing is emailed."; say(L(m, "")); return { status: "demo", error: m } },
      // ----- staff attendance (demo: this browser; me = signed-in user { email }) -----
      attToday: async (me) => {
        const S0 = ref.current, uid = S0.USERS.find((u) => u.email === me?.email)?.id, d = iso(new Date()), t = hhmm()
        const entries = S0.ATT.filter((e) => e.userId === uid && e.date === d)
        return { settings: S0.ATTSET, today: d, now: t, entries, status: dayStatus(entries, d, d, t, S0.ATTSET) }
      },
      clockIn: async (me) => {
        const S0 = ref.current, uid = S0.USERS.find((u) => u.email === me?.email)?.id, d = iso(new Date())
        if (!uid) { say(L("Sign in again.", "")); return "Sign in again." }
        if (S0.ATT.some((e) => e.userId === uid && e.date === d && e.kind === "work" && !e.out)) { say(L("You're already clocked in.", "")); return "You're already clocked in." }
        const e = { id: "a" + Date.now(), userId: uid, date: d, kind: "work", in: hhmm(), out: null, source: "clock" }
        up((n) => { n.ATT.push(e) }); say(L(`Clocked in at ${e.in}`, "")); return null
      },
      clockOut: async (me) => {
        const S0 = ref.current, uid = S0.USERS.find((u) => u.email === me?.email)?.id, d = iso(new Date())
        const open = S0.ATT.filter((e) => e.userId === uid && e.date === d && e.kind === "work" && !e.out); if (!open.length) { say(L("You're not clocked in.", "")); return "You're not clocked in." }
        const id = open[open.length - 1].id, t = hhmm()
        up((n) => { const e = n.ATT.find((z) => z.id === id); e.out = t > e.in ? t : e.in }); say(L(`Clocked out at ${t}`, "")); return null
      },
      attRegister: async ({ from, to, userId }, me) => {
        const S0 = ref.current, d = iso(new Date()), t = hhmm(), self = S0.USERS.find((u) => u.email === me?.email)
        const uid = self?.role === "admin" ? userId : self?.id
        const entries = S0.ATT.filter((e) => e.date >= from && e.date <= to && (!uid || e.userId === uid)).sort((a, b) => (a.date + (a.in ?? "")).localeCompare(b.date + (b.in ?? "")))
        const withE = new Set(entries.map((e) => e.userId))
        const users = S0.USERS.filter((u) => (uid ? u.id === uid : u.active || withE.has(u.id))).map((u) => ({ id: u.id, name: u.name, role: u.role, active: u.active, since: u.createdAt ? iso(new Date(u.createdAt)) : null })).sort((a, b) => a.name.localeCompare(b.name))
        const since = Object.fromEntries(users.map((u) => [u.id, u.since]))
        return { settings: S0.ATTSET, today: d, now: t, entries, users, summary: attSummary(entries, users.map((u) => u.id), from, to, d, t, S0.ATTSET, since) }
      },
      attAdd: async (b) => {
        const today = iso(new Date())
        if (b.kind === "work") {
          if (b.date > today) return "Work time can't be entered for a future day"
          const e = checkTimes(b.timeIn, b.timeOut); if (e) return e
          up((n) => { n.ATT.push({ id: "a" + Date.now(), userId: b.userId, date: b.date, kind: "work", in: b.timeIn, out: b.timeOut || null, note: b.note || "", source: "manual" }) }); say(L("Entry added", "")); return null
        }
        if (!LEAVE_TYPES[b.leaveType]) return "Choose a leave type"
        const to = b.toDate || b.date; if (to < b.date) return "Leave can cover up to 60 days at a time"
        const days = daysBetween(b.date, to); if (days.length > 61) return "Leave can cover up to 60 days at a time"
        const fresh = days.filter((d) => !ref.current.ATT.some((e) => e.userId === b.userId && e.date === d && e.kind === "leave")); if (!fresh.length) return "Leave is already recorded for those days."
        up((n) => { fresh.forEach((d, i) => n.ATT.push({ id: "a" + Date.now() + i, userId: b.userId, date: d, kind: "leave", leaveType: b.leaveType, note: b.note || "", source: "manual" })) })
        say(L(`Leave recorded · ${fresh.length} day${fresh.length > 1 ? "s" : ""}`, "")); return null
      },
      attEdit: async (id, b) => {
        const e0 = ref.current.ATT.find((z) => z.id === id); if (!e0) return "Entry not found."
        if (String(b.reason ?? "").trim().length < 3) return "Give a reason for the correction (kept in the audit log)"
        if (e0.kind === "work") { const e = checkTimes(b.timeIn, b.timeOut); if (e) return e } else if (!LEAVE_TYPES[b.leaveType]) return "Choose a leave type"
        up((n) => { const e = n.ATT.find((z) => z.id === id); if (e.kind === "work") { e.in = b.timeIn; e.out = b.timeOut || null } else e.leaveType = b.leaveType; e.note = b.note || ""; e.updatedAt = now() })
        say(L("Entry corrected", "")); return null
      },
      attDelete: async (id, reason) => { if (String(reason ?? "").trim().length < 3) return "Give a reason for deleting (kept in the audit log)"; up((n) => { n.ATT = n.ATT.filter((z) => z.id !== id) }); say(L("Entry deleted", "")); return null },
      attSettings: async (raw) => { const { d, error } = checkSettings(raw); if (error) return error; up((n) => { n.ATTSET = d }); say(L("Attendance settings saved", "")); return null },
      // ----- staff users (demo: kept in this browser; demo sign-in code is 246810) -----
      listUsers: async () => ref.current.USERS.map(({ pwHash, ...u }) => u),
      demoSignIn: async (email, pw) => { const u = ref.current.USERS.find((z) => z.email === String(email).trim().toLowerCase() && z.active); return u && u.pwHash === (await demoHash(pw)) ? { id: u.id, name: u.name, role: u.role, email: u.email } : null },
      saveUser: async (data, id, me) => {
        const { d, error } = checkUser(data); if (error) return { error }
        const U = ref.current.USERS, cur = id && U.find((z) => z.id === id), active = id ? data.active !== false : true
        if (U.some((z) => z.email === d.email && z.id !== id)) return { error: `${d.email} already has a login.` }
        if (cur && cur.email === me && (d.role !== "admin" || !active)) return { error: "You can't remove your own admin rights or deactivate yourself. Ask another admin." }
        if (cur && cur.role === "admin" && cur.active && (d.role !== "admin" || !active) && !U.some((z) => z.id !== id && z.role === "admin" && z.active)) return { error: "This is the only active admin. Make someone else admin first." }
        if (!id) { const e = checkPassword(data.password); if (e) return { error: e } }
        const pwHash = id ? null : await demoHash(data.password)
        up((n) => { if (id) Object.assign(n.USERS.find((z) => z.id === id), d, { active }); else n.USERS.push({ id: nextId("u", n.USERS), ...d, active: true, pwHash, createdAt: new Date().toISOString() }) })
        say(L(id ? "User updated" : `Login created for ${d.name}`, "")); return {}
      },
      resetUserPassword: async (id, pw) => { const e = checkPassword(pw); if (e) return e; const h = await demoHash(pw); up((n) => { n.USERS.find((z) => z.id === id).pwHash = h }); say(L("Password reset", "")); return null },
      changeMyPassword: async (current, pw, me) => {
        const u = ref.current.USERS.find((z) => z.email === me); if (!u || u.pwHash !== (await demoHash(current))) return "Current password is wrong."
        const e = checkPassword(pw); if (e) return e; if (current === pw) return "Choose a password different from the current one."
        const h = await demoHash(pw); up((n) => { n.USERS.find((z) => z.id === u.id).pwHash = h }); say(L("Password changed", "")); return null
      },
      // ----- therapy menu & package catalogue -----
      saveTherapy: (data, id) => {
        const { d, error } = checkTherapy(data, { id, all: ref.current.SVC }); if (error) return { error }
        const newId = id ?? nextId("th", ref.current.SVC)
        up((n) => { if (id) { const t = n.SVC.find((z) => z.id === id); for (const k of ["code", "normal", "label", "benefits"]) delete t[k]; Object.assign(t, d) } else n.SVC.push({ id: newId, ...d }) })
        say(id ? L("Therapy updated", "") : L(`Therapy added · ${d.name.en}`, "")); return { id: newId }
      },
      /** delete = archive (past visits / invoices keep the name). Not while a package still includes it. */
      deleteTherapy: (id) => {
        const s0 = ref.current, inPk = s0.PKG.filter((g) => !g.archived && (g.items ?? []).some((i) => i.svc === id))
        if (inPk.length) return L(`Used in package${inPk.length > 1 ? "s" : ""}: ${inPk.map((g) => g.name.en).join(", ")}. Remove it from ${inPk.length > 1 ? "those packages" : "that package"} first.`, "")
        up((n) => { n.SVC.find((z) => z.id === id).archived = true }); say(L("Therapy deleted", "")); return null
      },
      importTherapies: (rows) => {
        const added = rows.filter((r) => !r.id).length, updated = rows.length - added
        up((n) => { for (const r of rows) { if (r.id) { const t = n.SVC.find((z) => z.id === r.id); for (const k of ["code", "normal", "label", "benefits"]) delete t[k]; Object.assign(t, r.d) } else { n.SVC.push({ id: nextId("th", n.SVC), ...r.d }) } } })
        say(L(`Import done · ${added} added, ${updated} updated`, "")); return { added, updated }
      },
      savePackage: (data, id) => {
        const s0 = ref.current, { d, error } = checkPackage(data, { id, all: s0.PKG, therapies: s0.SVC }); if (error) return { error }
        const newId = id ?? nextId("pkg", s0.PKG)
        up((n) => { if (id) Object.assign(n.PKG.find((z) => z.id === id), d); else n.PKG.push({ id: newId, ...d }) })
        say(id ? L("Package updated · applies to new sales", "") : L(`Package added · ${d.name.en}`, "")); return { id: newId }
      },
      /** delete = stop selling. Clients who bought it keep their sessions on the terms they bought. */
      deletePackage: (id) => { up((n) => { n.PKG.find((z) => z.id === id).archived = true }); say(L("Package deleted · clients who bought it keep their sessions", "")); return null },
      importPackages: (rows) => {
        const added = rows.filter((r) => !r.id).length, updated = rows.length - added
        up((n) => { for (const r of rows) { if (r.id) { Object.assign(n.PKG.find((z) => z.id === r.id), r.d) } else { n.PKG.push({ id: nextId("pkg", n.PKG), ...r.d }) } } })
        say(L(`Import done · ${added} added, ${updated} updated`, "")); return { added, updated }
      },
      // ----- accounting -----
      /** Go-live opening balances: { "1000": cash, "1010": bank, ... } as at a date. Posted against 3000 Owner's capital. */
      setOpening: (amounts, date) => {
        const rows = Object.entries(amounts).map(([c, v]) => [c, Number(v) || 0]).filter(([, v]) => v > 0)
        if (!rows.length) return L("Enter at least one amount.", "")
        up((n) => { for (const [c, v] of rows) { post(n, `Opening balance · ${acc(c).name}`, ["2000", "2100", "2200", "2300"].includes(c) ? A.capital : c, ["2000", "2100", "2200", "2300"].includes(c) ? c : A.capital, v, "OPENING"); if (date) n.J[0].date = date } })
        say(L("Opening balances posted", "")); return null
      },
      setSST: (patch) => up((n) => { n.SET = { ...(n.SET ?? {}), sst: { ...sstOf(n), ...patch } }; say(L("SST settings saved", "")) }),
      /** Add expense (money out). code = expense account (6xxx), 2000 (pay supplier bill) or 3200 (drawings). */
      addExpense: ({ code, amount, method, note, status = "paid", ref }) => {
        const a = Number(amount); if (!(a > 0)) return L("Enter an amount.", ""); if (!code) return L("Choose a category.", "")
        up((n) => moneyOut(n, { d: note ? `${acc(code).name} · ${note}` : acc(code).name, code, amount: a, method, status, ref }))
        say(status === "paid" ? L("Expense recorded", "") : L("Bill recorded as unpaid (payable)", "")); return null
      },
      /** Add payment (money in) not linked to a visit, e.g. retail sale, deposit, other income. SST worked out from the patient. */
      addPayment: ({ pid, d, kind, amount, method, status = "paid", ref }) => {
        const a = Number(amount); if (!(a > 0)) return L("Enter an amount.", ""); if (!d) return L("Enter a description.", "")
        up((n) => { const pt = pid ? p(n, pid) : null, code = taxCodeFor(kind, pt ?? { citizenship: "citizen" }, sstOf(n), iso(new Date())), tax = code === "SV6" ? r2((a * sstOf(n).rate) / 100) : 0
          moneyIn(n, { d, parts: [{ acc: incomeAcc(kind), net: a, tax, taxCode: code }], method, status, pid, ref, taxCode: code }) })
        say(status === "paid" ? L("Payment recorded", "") : L("Payment recorded as pending", "")); return null
      },
      /**
       * Change a transaction's status.
       * pending → paid (money arrives: Dr cash Cr 1100 / Dr 2000 Cr cash) · pending → failed (stays owed) · failed → pending/paid
       * any → cancelled: reverses its postings (refund if it was paid).
       */
      setTxStatus: (id, to, method) => {
        const t0 = ref.current.TX.find((z) => z.id === id)
        if (!t0 || t0.status === to || t0.status === "cancelled") return
        up((n) => {
          const t = n.TX.find((z) => z.id === id), m = method ?? t.method, was = t.status
          if (t.type === "in") {
            if (to === "paid") post(n, `${t.no} received · ${t.d}`, cashAcc(m), A.ar, t.amount, t.no)
            if (to === "cancelled") { const from = was === "paid" ? cashAcc(t.method) : A.ar; for (const pt of t.parts ?? []) { post(n, `${t.no} cancelled · ${t.d}`, pt.acc, from, pt.net, t.no); post(n, `${t.no} cancelled · SST`, A.sst, from, pt.tax, t.no) } }
            const inv = n.INVC.find((i) => i.txId === id); if (inv) inv.status = to
          } else {
            if (to === "paid" && t.acc !== A.ap) post(n, `${t.no} paid · ${t.d}`, A.ap, cashAcc(m), t.amount, t.no)
            if (to === "cancelled") post(n, `${t.no} cancelled · ${t.d}`, was === "paid" ? cashAcc(t.method) : A.ap, t.acc, t.amount, t.no)
          }
          t.status = to; t.method = m; (t.log ??= []).push({ at: now(), from: was, to })
        })
        say(L(`${id} marked ${to}`, ""))
      },
    }
  }, [])

  // ------------------------------------------------------------ live mode (API)
  const remote = useMemo(() => {
    let tid
    const say = (msg) => { clearTimeout(tid); setToast({ msg }); tid = setTimeout(() => setToast(null), 2600) }
    const today = () => iso(new Date())
    const call = async (method, path, body) => {
      const r = await fetch(cfg.current.api + path, { method, headers: { "content-type": "application/json", ...(authRef.current?.token ? { authorization: "Bearer " + authRef.current.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
      let json = null; try { json = await r.json() } catch {}
      if (r.status === 401 && !path.startsWith("/auth/")) { setAuth(null); try { sessionStorage.removeItem("dvc.auth") } catch {} }
      return { ok: r.ok, status: r.status, json, msg: json?.issues?.[0]?.message ?? json?.message ?? `Server error (${r.status})` }
    }
    const refresh = async () => { const r = await call("GET", "/state"); if (r.ok) setS((old) => ({ ...old, ...r.json })) ; return r.ok }
    const fail = (r) => { say(L(r.msg, "")); return false }
    // notes typed in the consultation are saved shortly after typing stops
    const pending = {}
    const flush = async (vid) => { const p = pending[vid]; if (!p) return; clearTimeout(p.t); delete pending[vid]; await p.run() }
    const R = {
      say,
      reset: () => say(L("Live mode: data is on the clinic server and cannot be cleared here.", "")),
      login: async (email, password) => { const r = await call("POST", "/auth/login", { email, password }); return r.ok ? { challengeId: r.json.challengeId, devCode: r.json.devCode } : { error: r.msg } },
      verify: async (challengeId, code) => { const r = await call("POST", "/auth/verify", { challengeId, code }); if (!r.ok) return { error: r.msg }; const a = { token: r.json.token, user: r.json.user }; setAuth(a); authRef.current = a; try { sessionStorage.setItem("dvc.auth", JSON.stringify(a)) } catch {}; await refresh(); return { user: r.json.user } },
      logout: () => { setAuth(null); try { sessionStorage.removeItem("dvc.auth") } catch {} },
      refresh,
      /** send (again) the invoice or receipt for a bill to the patient's email */
      emailBill: async (invNo, kind) => {
        const r = await call("POST", `/invoices/${invNo}/email`, { kind }); if (!r.ok) { fail(r); return { status: "failed", error: r.msg } }
        await refresh(); const j = r.json
        say(L(j.status === "sent" ? `${kind === "receipt" ? "Receipt" : "Invoice"} emailed` : j.status === "skipped" ? j.error : j.status === "logged" ? "Email isn't set up yet (EMAIL_PROVIDER=log): printed in the server console" : `Email failed: ${j.error ?? j.status}`, "")); return j
      },
      attToday: async () => { const r = await call("GET", "/attendance/today"); return r.ok ? r.json : null },
      clockIn: async () => { const r = await call("POST", "/attendance/clock-in"); if (!r.ok) { say(L(r.msg, "")); return r.msg } say(L(`Clocked in at ${r.json.entries.at(-1)?.in ?? ""}`, "")); return null },
      clockOut: async () => { const r = await call("POST", "/attendance/clock-out"); if (!r.ok) { say(L(r.msg, "")); return r.msg } say(L("Clocked out", "")); return null },
      attRegister: async ({ from, to, userId }) => { const r = await call("GET", `/attendance?from=${from}&to=${to}${userId ? `&userId=${userId}` : ""}`); return r.ok ? r.json : { error: r.msg } },
      attAdd: async (b) => { const r = await call("POST", "/attendance", b); if (!r.ok) return r.msg; say(L(b.kind === "leave" ? `Leave recorded · ${r.json.created} day${r.json.created > 1 ? "s" : ""}` : "Entry added", "")); return null },
      attEdit: async (id, b) => { const r = await call("PUT", `/attendance/${id}`, b); if (!r.ok) return r.msg; say(L("Entry corrected", "")); return null },
      attDelete: async (id, reason) => { const r = await call("POST", `/attendance/${id}/delete`, { reason }); if (!r.ok) return r.msg; say(L("Entry deleted", "")); return null },
      attSettings: async (raw) => { const { d, error } = checkSettings(raw); if (error) return error; const r = await call("PUT", "/attendance/settings", d); if (!r.ok) return r.msg; say(L("Attendance settings saved", "")); return null },
      listUsers: async () => { const r = await call("GET", "/users"); return r.ok ? r.json : [] },
      saveUser: async (data, id) => {
        const { d, error } = checkUser(data); if (error) return { error }
        if (!id) { const e = checkPassword(data.password); if (e) return { error: e } }
        const r = await call(id ? "PUT" : "POST", id ? `/users/${id}` : "/users", id ? { ...d, active: data.active !== false } : { ...d, password: data.password })
        if (!r.ok) return { error: r.msg }; say(L(id ? "User updated" : `Login created for ${d.name}`, "")); return {}
      },
      resetUserPassword: async (id, pw) => { const e = checkPassword(pw); if (e) return e; const r = await call("POST", `/users/${id}/password`, { password: pw }); if (!r.ok) return r.msg; say(L("Password reset · they are signed out on every device", "")); return null },
      /** the server signs this user out everywhere afterwards, so the app returns to the sign-in screen */
      changeMyPassword: async (current, pw) => {
        const e = checkPassword(pw); if (e) return e
        const r = await call("POST", "/me/password", { current, password: pw }); if (!r.ok) return r.msg
        say(L("Password changed · sign in with the new password", "")); setTimeout(() => { setAuth(null); try { sessionStorage.removeItem("dvc.auth") } catch {} }, 1200); return null
      },
      savePatient: async (data, id) => {
        const { d, error } = checkPatient(data, id, ref.current.P); if (error) return { error }
        const body = { name: d.name, citizenship: d.citizenship, idType: d.idType, idNo: d.idNo, dob: d.dob || "", sex: d.sex || "", phone: d.phone, email: d.email || "", address: d.address || "", allergy: d.allergy || "", flags: d.flags || [], emergencyName: d.emergencyName || "", emergencyPhone: d.emergencyPhone || "", notes: d.notes || "", pdpaConsent: true, heightCm: d.heightCm ?? null, weightKg: d.weightKg ?? null, bp: d.bp || "" }
        const r = await call(id ? "PUT" : "POST", id ? `/patients/${id}` : "/patients", body); if (!r.ok) return { error: r.msg }
        await refresh(); say(id ? L("Patient record updated", "") : L(`Patient registered · ${r.json.id}`, "")); return { id: r.json.id }
      },
      addVisit: async (pid, unit, prac, svc, kind = "walkin", time, date) => {
        if (kind === "appt") { const e = checkAppointment(date || iso(new Date()), time); if (e) { say(L(e, "")); return false } }
        const [sv, pkSvc] = String(svc ?? "").startsWith("session") ? ["session", svc.split(":")[1] || undefined] : [svc, undefined]
        const r = await call("POST", "/visits", { patientId: pid, unitId: unit, practitionerId: prac, serviceId: unit === "tx" ? sv : undefined, packageServiceId: pkSvc, kind, slot: time, date: kind === "appt" ? date || iso(new Date()) : undefined }); if (!r.ok) { fail(r); return false }
        await refresh(); say(kind === "walkin" ? L("Added to the queue", "") : L("Appointment booked", "")); return true },
      checkIn: async (id) => { const r = await call("POST", `/visits/${id}/check-in`); if (!r.ok) return fail(r); await refresh(); say(L("Checked in", "")) },
      deleteVisit: async (id) => { const r = await call("DELETE", `/visits/${id}`); if (!r.ok) return r.msg; await refresh(); say(L("Appointment deleted", "")); return null },
      clearQueue: async (unit, date = iso(new Date())) => {
        const r = await call("POST", "/queue/clear", { unitId: unit, date }); if (!r.ok) { fail(r); return null } await refresh()
        const { removed, hidden, kept } = r.json; say(L(`Queue cleared · ${removed} removed${hidden ? `, ${hidden} finished hidden` : ""}${kept ? ` · ${kept} still in progress` : ""}`, "")); return r.json },
      cancelVisit: async (id) => { const r = await call("POST", `/visits/${id}/cancel`); if (!r.ok) return fail(r); await refresh(); say(L("Visit cancelled", "")) },
      startVisit: async (id) => { const r = await call("POST", `/visits/${id}/start`); if (!r.ok) return fail(r); await refresh() },
      setRx: (vid, patch) => {
        setS((o) => { const cur = o.rx?.[vid] ?? { items: [], dx: "", dosha: "", note: "", mc: 0, svc: "cons" }; return { ...o, rx: { ...o.rx, [vid]: { ...cur, ...patch } } } })
        clearTimeout(pending[vid]?.t)
        const run = async () => { const rx = ref.current.rx[vid]; if (!rx) return; const r = await call("PUT", `/visits/${vid}/notes`, { serviceId: rx.svc, diagnosis: rx.dx || undefined, dosha: rx.dosha || undefined, notes: rx.note ?? "", mcDays: Number(rx.mc) || 0 }); if (!r.ok) fail(r) }
        pending[vid] = { run, t: setTimeout(() => { delete pending[vid]; run() }, 700) }
      },
      addRx: async (vid, itemId, qty) => {
        await flush(vid)
        const s0 = ref.current, x = s0.Q.find((q) => q.id === vid), item = s0.INV.find((z) => z.id === itemId), pt = s0.P.find((q) => q.id === x.pid)
        const loc = safetyCheck(item, qty, pt); if (loc.block) return loc
        const r = await call("POST", `/visits/${vid}/rx`, { itemId, qty: Number(qty) })
        if (r.status === 422) return { block: L(r.msg, "") }
        if (!r.ok) { fail(r); return {} }
        await refresh(); return r.json.warning ? { warn: L(r.json.warning, "") } : {}
      },
      delRx: async (vid, i) => { const rid = ref.current.rx[vid]?.items[i]?.rid; if (!rid) return; const r = await call("DELETE", `/visits/${vid}/rx/${rid}`); if (!r.ok) return fail(r); await refresh() },
      complete: async (vid) => { await flush(vid); const r = await call("POST", `/visits/${vid}/complete`); if (!r.ok) return L(r.msg, ""); await refresh(); setTimeout(() => refresh(), 2500); say(L(`Visit completed · invoice ${r.json.invoice ?? ""}`, "")); return null },
      dispense: async (vid) => { const r = await call("POST", `/visits/${vid}/dispense`); if (!r.ok) return fail(r); await refresh(); say(L("Dispensed. Stock updated.", "")) },
      saveProduct: async (data, id) => {
        const { d, error } = checkProduct(data, { id, all: ref.current.INV }); if (error) return { error }
        const r = await call(id ? "PUT" : "POST", id ? `/inventory/${id}` : "/inventory", d); if (!r.ok) return { error: r.msg }
        await refresh(); say(id ? L("Product updated", "") : L(`Product added · ${d.name}`, "")); return { id: r.json.id }
      },
      deleteProduct: async (id) => { const r = await call("DELETE", `/inventory/${id}`); if (!r.ok) return L(r.msg, ""); await refresh(); say(L("Product deleted", "")); return null },
      importProducts: async (rows) => {
        const r = await call("POST", "/inventory/import", { rows: rows.map((x) => ({ id: x.id, line: x.line, ...x.d })) }); if (!r.ok) { fail(r); return { error: r.msg, errors: r.json?.errors } }
        await refresh(); say(L(`Import done · ${r.json.added} added, ${r.json.updated} updated`, "")); return r.json
      },
      reorder: async (itemId) => {
        const i = ref.current.INV.find((z) => z.id === itemId), q = reorderQty(i)
        const r = await call("POST", `/inventory/${itemId}/receive`, { qty: q, cost: Math.round(q * (i.cost || i.price * 0.55) * 100) / 100 }); if (!r.ok) return fail(r)
        await refresh(); say(L(`Stock received: ${q} × ${i.name}. Supplier bill added to payables.`, ""))
      },
      pay: async (vid, method, extrasMethod = "duitnow") => { const r = await call("POST", `/visits/${vid}/pay`, { method, extrasMethod }); if (!r.ok) { fail(r); return false } await refresh(); setTimeout(() => refresh(), 2500); say(r.json.status === "pending" ? L(`Invoice ${r.json.invoice} issued · waiting for bank transfer`, "") : L(`Paid · receipt ${r.json.invoice}`, "")); return true },
      sellPackage: async (pkgId, pid, method, plan = "full", amount) => {
        if (!pid) return L("Choose a patient.", "")
        const g = pkgOf(pkgId), amt = plan === "full" ? g.price : Number(amount), err = checkPayment(g, 0, amt, true); if (err) return err
        const r = await call("POST", "/client-packages", { patientId: pid, packageId: pkgId, plan, amount: plan === "partial" ? amt : undefined, method }); if (!r.ok) return L(r.msg, "")
        await refresh(); say(plan === "full" ? L("Package sold and paid in full. All sessions unlocked.", "") : L("Deposit received. Sessions unlock as the balance is paid.", "")); return null
      },
      collectBalance: async (kid, amount, method) => { const r = await call("POST", `/client-packages/${kid}/payments`, { amount: Number(amount), method }); if (!r.ok) return L(r.msg, ""); await refresh(); say(L("Payment received.", "")); return null },
      useSession: async (kid, svc) => { const r = await call("POST", `/client-packages/${kid}/sessions`, { serviceId: svc }); if (!r.ok) { fail(r); return false } await refresh(); say(L("Session recorded", "")); return true },
      saveTherapy: async (data, id) => {
        const { d, error } = checkTherapy(data, { id, all: ref.current.SVC }); if (error) return { error }
        const r = await call(id ? "PUT" : "POST", id ? `/services/${id}` : "/services", d); if (!r.ok) return { error: r.msg }
        await refresh(); say(id ? L("Therapy updated", "") : L(`Therapy added · ${d.name.en}`, "")); return { id: r.json.id }
      },
      deleteTherapy: async (id) => { const r = await call("DELETE", `/services/${id}`); if (!r.ok) return L(r.msg, ""); await refresh(); say(L("Therapy deleted", "")); return null },
      importTherapies: async (rows) => { const r = await call("POST", "/services/import", { rows: rows.map((x) => ({ id: x.id, line: x.line, ...x.d })) }); if (!r.ok) { fail(r); return { error: r.msg, errors: r.json?.errors } } await refresh(); say(L(`Import done · ${r.json.added} added, ${r.json.updated} updated`, "")); return r.json },
      savePackage: async (data, id) => {
        const { d, error } = checkPackage(data, { id, all: ref.current.PKG, therapies: ref.current.SVC }); if (error) return { error }
        const r = await call(id ? "PUT" : "POST", id ? `/packages/${id}` : "/packages", d); if (!r.ok) return { error: r.msg }
        await refresh(); say(id ? L("Package updated · applies to new sales", "") : L(`Package added · ${d.name.en}`, "")); return { id: r.json.id }
      },
      deletePackage: async (id) => { const r = await call("DELETE", `/packages/${id}`); if (!r.ok) return L(r.msg, ""); await refresh(); say(L("Package deleted · clients who bought it keep their sessions", "")); return null },
      importPackages: async (rows) => { const r = await call("POST", "/packages/import", { rows: rows.map((x) => ({ id: x.id, line: x.lines, ...x.d })) }); if (!r.ok) { fail(r); return { error: r.msg, errors: r.json?.errors } } await refresh(); say(L(`Import done · ${r.json.added} added, ${r.json.updated} updated`, "")); return r.json },
      setSST: async (patch) => { const next = { ...(ref.current.SET?.sst ?? DEFAULT_SST), ...patch }; const r = await call("PUT", "/settings/sst", { registered: !!next.registered, regNo: next.regNo || "", rate: Number(next.rate) || 0, effectiveFrom: next.effectiveFrom || "", threshold: Number(next.threshold) || 1500000, consultExempt: !!next.consultExempt, medicinesTaxable: !!next.medicinesTaxable }); if (!r.ok) return fail(r); await refresh(); say(L("SST settings saved", "")) },
      addExpense: async ({ code, amount, method, note, status = "paid", ref: reference }) => { const a = Number(amount); if (!(a > 0)) return L("Enter an amount.", ""); const r = await call("POST", "/expenses", { code, amount: a, method, status, note: note || undefined, reference: reference || undefined }); if (!r.ok) return L(r.msg, ""); await refresh(); say(status === "paid" ? L("Expense recorded", "") : L("Bill recorded as unpaid (payable)", "")); return null },
      addPayment: async ({ pid, d, kind, amount, method, status = "paid", ref: reference }) => { const a = Number(amount); if (!(a > 0)) return L("Enter an amount.", ""); if (!d) return L("Enter a description.", ""); const r = await call("POST", "/payments", { description: d, kind, amount: a, method, status, patientId: pid || undefined, reference: reference || undefined }); if (!r.ok) return L(r.msg, ""); await refresh(); say(status === "paid" ? L("Payment recorded", "") : L("Payment recorded as pending", "")); return null },
      setTxStatus: async (id, to, method) => { const r = await call("POST", `/transactions/${id}/status`, { status: to, method }); if (!r.ok) return fail(r); await refresh(); say(L(`${id} marked ${to}`, "")) },
      setOpening: async (amounts, date) => { const balances = Object.fromEntries(Object.entries(amounts).map(([c, v]) => [c, Number(v) || 0]).filter(([, v]) => v > 0)); if (!Object.keys(balances).length) return L("Enter at least one amount.", ""); const r = await call("POST", "/opening-balances", { date: date || today(), balances }); if (!r.ok) return L(r.msg, ""); await refresh(); say(L("Opening balances posted", "")); return null },
    }
    return R
  }, [])
  useEffect(() => { if (mode === "live") setS(seed()) }, [mode])                        // never show browser demo data in live mode
  useEffect(() => { if (mode === "live" && auth?.token) remote.refresh() }, [mode, auth?.token, remote])
  setCatalog(S.SVC, S.PKG)          // rules.js (pkgOf / svcOf / invoiceFor) read the current therapy menu and packages
  const value = mode === "live" ? { S, toast, mode, auth, ...remote } : { S, toast, mode, auth: null, ...api }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
export const useStore = () => useContext(Ctx)
export const findPatient = (S, id) => S.P.find((p) => p.id === id)
export const unitOf = (id) => UNITS.find((u) => u.id === id)
export const isToday = (d) => d === iso(new Date())
export const ageOf = (dob) => { if (!dob) return null; const b = new Date(dob), n = new Date(); let a = n.getFullYear() - b.getFullYear(); if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--; return a }
export const maskId = (id = "") => (id.length > 6 ? id.slice(0, 6) + "-••-" + id.replace(/\D/g, "").slice(-4) : id)
