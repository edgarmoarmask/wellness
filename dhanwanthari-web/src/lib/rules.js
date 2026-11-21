// Clinic business rules (pure functions). The server (dhanwanthari-server/app/rules.py) applies the same rules.
import { SERVICES, PAYMENT_POLICY } from "@data/clinic.js"
import { ageDays } from "@data/util.js"
import { catalog } from "./catalog.js"

export const unitType = (unit) => (unit === "tx" ? "therapy" : "consult")
/** therapies and packages are the clinic's own list (editable, deleted ones kept so history still shows names) */
export const therapies = () => catalog().therapy
export const pkgOf = (id) => catalog().packages.find((p) => p.id === id)
export const svcOf = (unit, id) => (unitType(unit) === "therapy" ? catalog().therapy : SERVICES.consult).find((s) => s.id === id)
export const therapyName = (id) => catalog().therapy.find((s) => s.id === id)?.name.en ?? id

/** Invoice lines for a visit. */
export function invoiceFor(visit, patient, rx, inventory) {
  const lines = []
  if (rx.svc === "session") lines.push({ d: visit.pkSvc ? `Package session (prepaid) · ${therapyName(visit.pkSvc)}` : "Package session (prepaid)", q: 1, p: 0, kind: "pkg" })
  else {
    const s = svcOf(visit.unit, rx.svc)
    lines.push({ d: s.normal ? `${s.name.en} (offer, normal RM${s.normal})` : s.name.en, q: 1, p: s.price, kind: unitType(visit.unit) === "consult" ? "cons" : "tx" })
  }
  for (const it of rx.items) { const m = inventory.find((z) => z.id === it.id); lines.push({ d: m.name, q: it.q, p: m.price, kind: "med" }) }
  return { lines, total: Math.round(lines.reduce((a, l) => a + l.q * l.p, 0) * 100) / 100 }
}

/**
 * Prescription safety. Returns { block, warn } messages ({en, ms}).
 * - sesame-based thailam + recorded sesame allergy → block
 * - pregnancy contraindication + pregnant flag → block
 * - sugar-based lehyam + diabetes flag → warn (Vaidya may still add)
 * - quantity above stock → block
 */
export function safetyCheck(item, qty, patient) {
  const allergy = (patient.allergy || "").toLowerCase()
  if (item.base === "sesame" && allergy.includes("sesame")) return { block: { en: `${item.name} is sesame-oil based and the patient has a recorded sesame allergy. Not added. Choose a coconut-based oil such as Murivenna.`, ms: `${item.name} berasaskan minyak bijan dan pesakit ada alahan bijan yang direkodkan. Tidak ditambah. Pilih minyak berasaskan kelapa seperti Murivenna.` } }
  if ((item.contra || []).includes("pregnancy") && (patient.flags || []).includes("pregnant")) return { block: { en: `${item.name} is not advised in pregnancy. Not added.`, ms: `${item.name} tidak disarankan semasa hamil. Tidak ditambah.` } }
  if (qty > item.stock) return { block: { en: `Only ${item.stock} in stock.`, ms: `Hanya ${item.stock} dalam stok.` } }
  if (item.sugar && (patient.flags || []).includes("diabetes")) return { warn: { en: `${item.name} contains sugar and the patient has diabetes. Added — review the dose.`, ms: `${item.name} mengandungi gula dan pesakit menghidap diabetes. Ditambah — semak dos.` } }
  return {}
}

export const reorderQty = (item) => Math.max(0, item.reorder * 2 - item.stock)
export const packageSessionValue = (pkg) => Math.round((pkg.price / pkg.sessions) * 100) / 100

const r2 = (n) => Math.round(n * 100) / 100
/**
 * Package payment state. Full payment unlocks every session; partial payment unlocks
 * sessions in line with the amount paid (paid ÷ value per session, rounded down).
 */
export function packageState(k) {
  // terms = the package as sold (name, price, sessions, therapies); later edits to the package only affect new sales
  const def = pkgOf(k.pkg), g = k.terms ? { ...def, ...k.terms, id: k.pkg } : def, paid = r2((k.payments || []).reduce((a, p) => a + p.amt, 0)), balance = r2(Math.max(0, g.price - paid))
  const per = packageSessionValue(g), unlocked = balance <= 0 ? g.sessions : Math.min(g.sessions, Math.floor((paid + 0.005) / per))
  // validity: valid until the sale date + N months (inclusive); no sessions after that
  const expiresOn = g.validityMonths ? addMonths(k.sold, g.validityMonths) : null, expired = !!expiresOn && todayIso() > expiresOn
  const left = g.sessions - k.used, canUse = left > 0 && k.used < unlocked && !expired
  const overdue = balance > 0 && ageDays(k.sold) > PAYMENT_POLICY.balanceDueDays
  // therapies in this package with sessions used / left of each
  const items = (g.items ?? []).map((i) => { const used = k.usage?.[i.svc] ?? 0; return { ...i, used, left: Math.max(0, i.n - used) } })
  return { g, paid, balance, per, unlocked, left, canUse, overdue, fully: balance <= 0, items, expiresOn, expired }
}

/** "2026-11-30" + 3 months → "2027-02-28" (day clamped to the month's end). Same on the server (app/rules.py add_months). */
export function addMonths(isoDay, n) {
  const [y, m, d] = String(isoDay).slice(0, 10).split("-").map(Number), t = (m - 1) + n, yy = y + Math.floor(t / 12), mm = ((t % 12) + 12) % 12
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate()
  return `${yy}-${String(mm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`
}
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` }

/** Which therapy a package session is for. Packages with therapies need one with sessions left; returns { svc } or { error }. */
export function sessionTherapy(k, svc) {
  const st = packageState(k)
  if (!st.items.length) return { svc: undefined }
  const open = st.items.filter((i) => i.left > 0)
  if (!svc) return open.length === 1 ? { svc: open[0].svc } : { error: { en: "Choose which therapy this session is for.", ms: "" } }
  const it = st.items.find((i) => i.svc === svc)
  if (!it) return { error: { en: `${therapyName(svc)} is not part of this package.`, ms: "" } }
  if (it.left <= 0) return { error: { en: `All ${it.n} ${therapyName(svc)} sessions on this package are used.`, ms: "" } }
  return { svc }
}
/** Minimum deposit for a partial payment. */
export const minDeposit = (g) => Math.ceil((g.price * PAYMENT_POLICY.minDepositPct) / 100)
/** Validate a payment against a package: deposit ≥ minimum, never more than the balance. Returns error {en,ms} or null. */
export function checkPayment(g, alreadyPaid, amt, isFirst) {
  const bal = r2(g.price - alreadyPaid)
  if (!(amt > 0)) return { en: "Enter an amount.", ms: "Masukkan amaun." }
  if (amt > bal + 0.001) return { en: `More than the balance (RM${bal.toFixed(2)}).`, ms: `Melebihi baki (RM${bal.toFixed(2)}).` }
  if (isFirst && amt < minDeposit(g)) return { en: `Minimum deposit is RM${minDeposit(g)} (${PAYMENT_POLICY.minDepositPct}%).`, ms: `Deposit minimum ialah RM${minDeposit(g)} (${PAYMENT_POLICY.minDepositPct}%).` }
  return null
}
