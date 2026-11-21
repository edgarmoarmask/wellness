// Pharmacy products: checks, CSV template / import / export, and the journal entries a stock change needs.
// The server (dhanwanthari-server/app/products.py) applies the same rules and messages.
import { FORMS } from "@data/inventory.js"
import { A, r2 } from "./ledger.js"

export const USES = { dispense: "Dispense to patients", therapy: "Therapy room only", both: "Both" }
export const BASES = { "": "None", sesame: "Sesame oil", coconut: "Coconut oil", other: "Other oil" }

/** CSV columns, in order. `id` blank = new product. */
export const CSV_COLUMNS = ["id", "name", "form", "unit", "stock", "reorder_level", "price", "cost", "batch", "expiry", "base_oil", "contains_sugar", "avoid_in_pregnancy", "use_for"]

const YES = new Set(["yes", "y", "true", "1"]), NO = new Set(["no", "n", "false", "0", ""])
const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(String(v).replace(/[, ]|RM/gi, "")))

/** "2027-03-31" or "31/03/2027" → "2027-03-31"; "" → ""; anything else → null */
export function isoDate(v) {
  const s = String(v ?? "").trim()
  if (!s) return ""
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/), y, mo, d
  if (m) [, y, mo, d] = m
  else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [, d, mo, y] = m
  else return null
  const t = new Date(Date.UTC(+y, +mo - 1, +d))
  return t.getUTCMonth() === +mo - 1 && t.getUTCDate() === +d ? t.toISOString().slice(0, 10) : null
}

/**
 * Validates a product. raw uses the app's field names (name, form, unit, stock, reorder, price, cost, batch, exp, base, sugar, contra, use).
 * Returns { d } (clean product without id) or { error }.
 */
export function checkProduct(raw, { id, all = [] } = {}) {
  const name = String(raw.name ?? "").trim().replace(/\s+/g, " ")
  if (name.length < 2) return { error: "Enter the product name" }
  if (name.length > 120) return { error: "Product name is too long (max 120 characters)" }
  if (all.some((i) => !i.archived && i.id !== id && i.name.trim().toLowerCase() === name.toLowerCase())) return { error: `A product called "${name}" already exists` }
  const form = String(raw.form ?? "").trim().toLowerCase()
  if (!FORMS[form]) return { error: `Form must be one of: ${Object.keys(FORMS).join(", ")}` }
  const unit = String(raw.unit ?? "").trim().toLowerCase()
  if (!unit) return { error: "Enter the unit (bottle, jar, pack…)" }
  const z = (v) => (v === "" || v === null || v === undefined ? 0 : v)
  const stock = num(z(raw.stock)), reorder = num(z(raw.reorder)), price = num(raw.price), cost = num(z(raw.cost))
  if (!Number.isInteger(stock) || stock < 0) return { error: "Stock must be a whole number, 0 or more" }
  if (!Number.isInteger(reorder) || reorder < 0) return { error: "Reorder level must be a whole number, 0 or more" }
  if (!(price >= 0)) return { error: "Enter the selling price (RM)" }
  if (!(cost >= 0)) return { error: "Cost price must be 0 or more (RM)" }
  const exp = isoDate(raw.exp)
  if (exp === null) return { error: "Expiry must be a date like 2027-03-31 or 31/03/2027" }
  const base = String(raw.base ?? "").trim().toLowerCase()
  if (!(base in BASES)) return { error: "Base oil must be sesame, coconut, other or blank" }
  const use = String(raw.use || "both").trim().toLowerCase()
  if (!USES[use]) return { error: "Use for must be dispense, therapy or both" }
  const contra = [...new Set((raw.contra ?? []).map((c) => String(c).trim().toLowerCase()).filter(Boolean))]
  return { d: { name, form, unit, stock, reorder, price: r2(price), cost: r2(cost), batch: String(raw.batch ?? "").trim(), exp, base: base || undefined, sugar: !!raw.sugar, contra, use } }
}

/**
 * Journal entries for adding / changing / deleting a product (cost × quantity).
 * new product with stock  → Dr 1200 inventory, Cr 3000 owner's capital ("opening stock")
 * stock count corrected   → difference at the old cost, 1200 ↔ 5030 stock adjustments
 * cost price changed      → remaining stock revalued, 1200 ↔ 5030
 * deleted with stock left → written off, Dr 5030, Cr 1200
 */
export function productPostings(before, after) {
  const out = [], add = (d, dr, cr, amt) => { if (r2(amt) > 0.004) out.push({ d, dr, cr, amt: r2(amt) }) }
  if (!before) { add(`Opening stock · ${after.name} × ${after.stock}`, A.inventory, A.capital, after.stock * after.cost); return out }
  if (!after) { add(`Product deleted · stock written off · ${before.name} × ${before.stock}`, A.stockAdj, A.inventory, before.stock * (before.cost || 0)); return out }
  const oldCost = before.cost || 0, diff = after.stock - before.stock
  if (diff > 0) add(`Stock count adjustment · ${after.name} +${diff}`, A.inventory, A.stockAdj, diff * oldCost)
  if (diff < 0) add(`Stock count adjustment · ${after.name} ${diff}`, A.stockAdj, A.inventory, -diff * oldCost)
  const reval = after.stock * (after.cost - oldCost)
  if (reval > 0) add(`Stock revalued · ${after.name} cost ${oldCost.toFixed(2)} → ${after.cost.toFixed(2)}`, A.inventory, A.stockAdj, reval)
  if (reval < 0) add(`Stock revalued · ${after.name} cost ${oldCost.toFixed(2)} → ${after.cost.toFixed(2)}`, A.stockAdj, A.inventory, -reval)
  return out
}

// ---------------------------------------------------------------- CSV
const cell = (v) => { const s = v === undefined || v === null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const csvText = (rows) => "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n"

const toRow = (i) => [i.id, i.name, i.form, i.unit, i.stock, i.reorder, i.price, i.cost, i.batch, i.exp, i.base || "", i.sugar ? "yes" : "no", (i.contra ?? []).includes("pregnancy") ? "yes" : "no", i.use]

export const templateCsv = () => csvText([CSV_COLUMNS,
  ["", "Pinda Thailam 200ml", "thailam", "bottle", 20, 10, 36, 19.8, "PT2611", "2027-12-31", "sesame", "no", "no", "both"]])

export const exportCsv = (items) => csvText([CSV_COLUMNS, ...items.filter((i) => !i.archived).map(toRow)])

/** RFC-4180 CSV → array of string arrays (handles quotes, commas and line breaks in quotes, BOM). */
export function parseCsv(text) {
  const rows = [], s = String(text).replace(/^﻿/, "")
  let row = [], f = "", q = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c; continue }
    if (c === '"') q = true
    else if (c === ",") { row.push(f); f = "" }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = "" }
    else f += c
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row) }
  return rows.filter((r) => r.some((x) => x.trim() !== ""))
}

/**
 * Reads an uploaded CSV against the current products.
 * Returns { error } for a bad file, or { rows: [{ line, id?, action: "add"|"update"|"same", d?, before?, error? }] }.
 * Matching: `id` column if filled, otherwise the product name (not case-sensitive).
 */
export function readProductCsv(text, all) {
  const t = parseCsv(text)
  if (!t.length) return { error: "The file is empty." }
  const head = t[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"))
  const missing = ["name", "form", "unit", "price"].filter((c) => !head.includes(c))
  if (missing.length) return { error: `Missing column(s): ${missing.join(", ")}. Download the template for the right headings.` }
  if (t.length < 2) return { error: "No product rows under the headings." }
  if (t.length > 2001) return { error: "Up to 2,000 products per file." }
  const seenNames = new Set(), seenIds = new Set(), rows = []
  for (let k = 1; k < t.length; k++) {
    const o = Object.fromEntries(head.map((h, j) => [h, (t[k][j] ?? "").trim()])), line = k + 1
    const yn = (v, col) => { const s = String(v ?? "").toLowerCase(); return YES.has(s) ? true : NO.has(s) ? false : `${col} must be yes or no` }
    const sugar = yn(o.contains_sugar, "contains_sugar"), preg = yn(o.avoid_in_pregnancy, "avoid_in_pregnancy")
    if (typeof sugar === "string" || typeof preg === "string") { rows.push({ line, name: o.name, error: typeof sugar === "string" ? sugar : preg }); continue }
    let before = null
    if (o.id) { before = all.find((i) => i.id === o.id && !i.archived); if (!before) { rows.push({ line, name: o.name, error: `No product with id ${o.id}. Leave id blank to add a new product.` }); continue } }
    else before = all.find((i) => !i.archived && i.name.trim().toLowerCase() === o.name.trim().replace(/\s+/g, " ").toLowerCase()) || null
    const contra = [...(before?.contra ?? []).filter((c) => c !== "pregnancy"), ...(preg ? ["pregnancy"] : [])]
    const raw = { name: o.name, form: o.form, unit: o.unit, stock: o.stock === undefined || o.stock === "" ? before?.stock ?? 0 : o.stock, reorder: o.reorder_level === undefined || o.reorder_level === "" ? before?.reorder ?? 0 : o.reorder_level,
      price: o.price, cost: o.cost === undefined || o.cost === "" ? before?.cost ?? 0 : o.cost, batch: o.batch ?? before?.batch, exp: o.expiry ?? before?.exp, base: o.base_oil ?? before?.base ?? "", sugar, contra, use: o.use_for || before?.use || "both" }
    const { d, error } = checkProduct(raw, { id: before?.id, all })
    if (error) { rows.push({ line, name: o.name, error }); continue }
    const key = d.name.toLowerCase()
    if (seenNames.has(key) || (before && seenIds.has(before.id))) { rows.push({ line, name: d.name, error: "This product appears more than once in the file" }); continue }
    seenNames.add(key); if (before) seenIds.add(before.id)
    const same = before && ["name", "form", "unit", "stock", "reorder", "price", "cost", "batch", "exp", "use"].every((f) => String(before[f] ?? "") === String(d[f] ?? "")) && (before.base || "") === (d.base || "") && !!before.sugar === d.sugar && (before.contra ?? []).join() === d.contra.join()
    rows.push({ line, id: before?.id, name: d.name, action: !before ? "add" : same ? "same" : "update", d, before })
  }
  return { rows }
}

/** the same data shape the server's POST /inventory/import expects */
export const importBody = (rows) => ({ rows: rows.filter((r) => !r.error && r.action !== "same").map((r) => ({ id: r.id, ...r.d })) })
