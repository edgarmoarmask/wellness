// Wellness therapies and packages the clinic sells: checks, CSV template / import / export.
// The server (dhanwanthari-server/app/catalog.py) applies the same rules and messages.
// A package is a collection of therapies, each with a number of sessions, sold at one package price.
import { parseCsv } from "./products.js"

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
export const GROUPS = { wellness: "Wellness offer", walkin: "Walk-in treatment" }
const GROUP_KEY = { "wellness offer": "wellness", "wellness package": "wellness", wellness: "wellness", "walk-in treatment": "walkin", "walk-in": "walkin", walkin: "walkin", "add-on": "walkin", addon: "walkin" }   // old CSVs: add-on → walk-in
export const LABELS = { "": "No offer label", promo: "Promo", member: "Member price", special: "Special offer" }
export const THERAPY_COLUMNS = ["id", "code", "name", "group", "mins", "price", "normal_price", "offer_label", "benefits", "book_ahead"]
export const PACKAGE_COLUMNS = ["package_id", "package_code", "package_name", "package_price", "duration", "validity_months", "inclusions", "therapy", "sessions"]

// ---- live catalogue (set by the store from its state; read by rules.js: pkgOf / svcOf)
let CAT = { therapy: [], packages: [] }
export const setCatalog = (therapy, packages) => { CAT = { therapy: therapy ?? [], packages: packages ?? [] } }
export const catalog = () => CAT

const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(String(v).replace(/[, ]|RM/gi, "")))
const clean = (v) => String(v ?? "").trim().replace(/\s+/g, " ")
const nameEn = (x) => (typeof x?.name === "object" ? x.name.en : x?.name) ?? ""
/** therapy by id or code (case-insensitive), deleted ones excluded */
export const findTherapy = (list, key) => { const k = clean(key).toLowerCase(); return k ? list.find((s) => !s.archived && (s.id.toLowerCase() === k || (s.code ?? "").toLowerCase() === k)) : undefined }

/** Therapy (fields: code, name, group, mins, price, normal, label, benefits, advance). Returns { d } or { error }. */
export function checkTherapy(raw, { id, all = [] } = {}) {
  const name = clean(typeof raw.name === "object" ? raw.name?.en : raw.name)
  if (name.length < 2) return { error: "Enter the therapy name" }
  if (name.length > 160) return { error: "Therapy name is too long (max 160 characters)" }
  if (all.some((s) => !s.archived && s.id !== id && nameEn(s).toLowerCase() === name.toLowerCase())) return { error: `A therapy called "${name}" already exists` }
  const code = clean(raw.code).toUpperCase()
  if (code.length > 12) return { error: "Code is too long (max 12 characters)" }
  if (code && all.some((s) => !s.archived && s.id !== id && (s.code ?? "").toUpperCase() === code)) return { error: `Code ${code} is already used` }
  const group = GROUP_KEY[clean(raw.group).toLowerCase()]
  if (!group) return { error: "Group must be wellness or walk-in" }
  const mins = raw.mins === "" || raw.mins === null || raw.mins === undefined ? null : num(raw.mins)
  if (mins !== null && !(Number.isInteger(mins) && mins >= 5 && mins <= 600)) return { error: "Duration must be whole minutes between 5 and 600 (or blank)" }
  const price = num(raw.price)
  if (!(price >= 0)) return { error: "Enter the price (RM)" }
  const normal = raw.normal === "" || raw.normal === null || raw.normal === undefined ? null : num(raw.normal)
  if (normal !== null && !(normal > price)) return { error: "Normal price must be higher than the price charged (or blank)" }
  const label = clean(raw.label).toLowerCase()
  if (!(label in LABELS)) return { error: "Offer label must be promo, member, special or blank" }
  const benefits = clean(typeof raw.benefits === "object" ? raw.benefits?.en : raw.benefits)
  if (benefits.length > 600) return { error: "Benefits text is too long (max 600 characters)" }
  return { d: { code: code || undefined, name: { en: name, ms: name }, group: GROUPS[group], wellness: group === "wellness", mins, price: r2(price),
    normal: normal === null ? undefined : r2(normal), label: label || undefined, benefits: benefits ? { en: benefits, ms: benefits } : undefined, advance: !!raw.advance } }
}

/** Package. Fixed: items [{ svc, n }] (sessions = their total). Flexible: no items + sessions (any therapy can be recorded).
 *  Optional: code ("PLAN 1"), duration ("3 weeks"), validityMonths (1–60), inclusions (lines). Returns { d } or { error }. */
export function checkPackage(raw, { id, all = [], therapies = [] } = {}) {
  const name = clean(typeof raw.name === "object" ? raw.name?.en : raw.name)
  if (name.length < 2) return { error: "Enter the package name" }
  if (name.length > 160) return { error: "Package name is too long (max 160 characters)" }
  if (all.some((g) => !g.archived && g.id !== id && nameEn(g).toLowerCase() === name.toLowerCase())) return { error: `A package called "${name}" already exists` }
  const items = []
  for (const it of raw.items ?? []) {
    const t = findTherapy(therapies, it.svc)
    if (!t) return { error: `Therapy "${it.svc}" not found. Use a therapy code or id from the therapy list.` }
    const n = num(it.n)
    if (!(Number.isInteger(n) && n >= 1 && n <= 100)) return { error: `Sessions for ${nameEn(t)} must be a whole number from 1 to 100` }
    if (items.some((x) => x.svc === t.id)) return { error: `${nameEn(t)} is listed twice. Put all its sessions on one line.` }
    items.push({ svc: t.id, n })
  }
  let sessions
  if (items.length) sessions = items.reduce((a, x) => a + x.n, 0)
  else {
    sessions = num(raw.sessions)
    if (raw.sessions === "" || raw.sessions === null || raw.sessions === undefined) return { error: "Add at least one therapy, or enter the total sessions for a flexible package" }
    if (!(Number.isInteger(sessions) && sessions >= 1)) return { error: "Total sessions must be a whole number, 1 or more" }
  }
  if (sessions > 200) return { error: "A package can have up to 200 sessions" }
  const price = num(raw.price)
  if (!(price > 0)) return { error: "Enter the package price (RM)" }
  const code = clean(raw.code).toUpperCase()
  if (code.length > 20) return { error: "Plan code is too long (max 20 characters)" }
  if (code && all.some((g) => !g.archived && g.id !== id && (g.code ?? "").toUpperCase() === code)) return { error: `Plan code ${code} is already used` }
  const duration = clean(raw.duration)
  if (duration.length > 40) return { error: "Duration is too long (max 40 characters)" }
  const vm = raw.validityMonths === "" || raw.validityMonths === null || raw.validityMonths === undefined ? null : num(raw.validityMonths)
  if (vm !== null && !(Number.isInteger(vm) && vm >= 1 && vm <= 60)) return { error: "Validity must be whole months from 1 to 60 (or blank)" }
  const inc = (Array.isArray(raw.inclusions) ? raw.inclusions : String(raw.inclusions ?? "").split(/\r?\n|;/)).map(clean).filter(Boolean)
  if (inc.length > 15) return { error: "Up to 15 inclusion lines" }
  if (inc.some((x) => x.length > 160)) return { error: "An inclusion line is too long (max 160 characters)" }
  return { d: { code: code || null, name: { en: name, ms: name }, items, sessions, price: r2(price), duration: duration || null, validityMonths: vm, inclusions: inc } }
}

/** what the sessions would cost one by one, and the saving */
export function packageValue(items, therapies) {
  const value = r2((items ?? []).reduce((a, x) => a + (therapies.find((s) => s.id === x.svc)?.price ?? 0) * x.n, 0))
  return { value }
}

// ---------------------------------------------------------------- CSV
const cell = (v) => { const s = v === undefined || v === null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const csvText = (rows) => "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n"
const groupKey = (g) => GROUP_KEY[String(g ?? "").toLowerCase()] ?? ""

export const therapyTemplateCsv = () => csvText([THERAPY_COLUMNS,
  ["", "SD", "Shirodhara", "walk-in", 60, 120, "", "", "Warm oil poured over the forehead; calms the mind, helps sleep.", "no"]])
export const therapyExportCsv = (list) => csvText([THERAPY_COLUMNS, ...list.filter((s) => !s.archived).map((s) =>
  [s.id, s.code ?? "", nameEn(s), groupKey(s.group), s.mins ?? "", s.price, s.normal ?? "", s.label ?? "", s.benefits?.en ?? "", s.advance ? "yes" : "no"])])

export const packageTemplateCsv = () => csvText([PACKAGE_COLUMNS,
  ["", "PLAN 2", "Spine Correction Program", 999, "4 weeks", 6, "Three Ayurvedic consultation with Nadi pareeksha; Exercise and posture correction", "", 7],
  ["", "", "Back care, 8 sessions", 1150, "", 3, "", "KTV", 6], ["", "", "Back care, 8 sessions", 1150, "", 3, "", "SD", 2]])
/** one row per therapy; a flexible package is one row with therapy blank and sessions = total. Package details on its first row. */
export const packageExportCsv = (pkgs, therapies) => csvText([PACKAGE_COLUMNS, ...pkgs.filter((g) => !g.archived).flatMap((g) =>
  (g.items?.length ? g.items : [{ svc: "", n: g.sessions }]).map((x, k) => { const t = therapies.find((s) => s.id === x.svc)
    return [g.id, k ? "" : g.code ?? "", nameEn(g), g.price, k ? "" : g.duration ?? "", k ? "" : g.validityMonths ?? "", k ? "" : (g.inclusions ?? []).join("; "), t?.code || t?.id || "", x.n] }))])

function readTable(text, required) {
  const t = parseCsv(text)
  if (!t.length) return { error: "The file is empty." }
  const head = t[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"))
  const missing = required.filter((c) => !head.includes(c))
  if (missing.length) return { error: `Missing column(s): ${missing.join(", ")}. Download the template for the right headings.` }
  if (t.length < 2) return { error: "No rows under the headings." }
  if (t.length > 2001) return { error: "Up to 2,000 rows per file." }
  return { rows: t.slice(1).map((r, k) => ({ line: k + 2, o: Object.fromEntries(head.map((h, j) => [h, (r[j] ?? "").trim()])) })) }
}

const YES = new Set(["yes", "y", "true", "1"]), NO = new Set(["no", "n", "false", "0", ""])

/** Therapy CSV → { rows: [{ line, id?, name, action: add|update|same, d, before, error? }] } or { error } */
export function readTherapyCsv(text, all) {
  const tb = readTable(text, ["name", "group", "price"]); if (tb.error) return tb
  const rows = [], seen = new Set()
  for (const { line, o } of tb.rows) {
    const adv = String(o.book_ahead ?? "").toLowerCase()
    if (!YES.has(adv) && !NO.has(adv)) { rows.push({ line, name: o.name, error: "book_ahead must be yes or no" }); continue }
    let before = null
    if (o.id) { before = all.find((s) => s.id === o.id && !s.archived); if (!before) { rows.push({ line, name: o.name, error: `No therapy with id ${o.id}. Leave id blank to add a new therapy.` }); continue } }
    else before = all.find((s) => !s.archived && nameEn(s).toLowerCase() === clean(o.name).toLowerCase()) || null
    const raw = { code: o.code ?? before?.code, name: o.name, group: o.group, mins: o.mins ?? before?.mins, price: o.price, normal: o.normal_price ?? "", label: o.offer_label ?? "", benefits: o.benefits ?? before?.benefits?.en, advance: YES.has(adv) }
    const { d, error } = checkTherapy(raw, { id: before?.id, all })
    if (error) { rows.push({ line, name: o.name, error }); continue }
    const key = before?.id ?? d.name.en.toLowerCase()
    if (seen.has(key) || seen.has("n:" + d.name.en.toLowerCase()) || (d.code && seen.has("c:" + d.code))) { rows.push({ line, name: d.name.en, error: "This therapy appears more than once in the file" }); continue }
    seen.add(key); seen.add("n:" + d.name.en.toLowerCase()); if (d.code) seen.add("c:" + d.code)
    const same = before && JSON.stringify(pickT(before)) === JSON.stringify(pickT(d))
    rows.push({ line, id: before?.id, name: d.name.en, action: !before ? "add" : same ? "same" : "update", d, before })
  }
  return { rows }
}
const pickT = (s) => [s.code ?? "", nameEn(s), s.group, s.mins ?? null, s.price, s.normal ?? null, s.label ?? "", s.benefits?.en ?? "", !!s.advance]

/** Package CSV (one row per therapy in a package; rows grouped by package_id, else package_name) → { rows: [{ line, id?, name, action, d, before, error? }] } */
export function readPackageCsv(text, all, therapies) {
  const tb = readTable(text, ["package_name", "package_price", "therapy", "sessions"]); if (tb.error) return tb
  const groups = new Map()
  for (const r of tb.rows) { const key = r.o.package_id ? "id:" + r.o.package_id : "n:" + clean(r.o.package_name).toLowerCase(); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r) }
  const rows = []
  for (const [, list] of groups) {
    const { line, o } = list[0], lines = list.map((r) => r.line).join(", ")
    const prices = new Set(list.map((r) => num(r.o.package_price)))
    if (prices.size > 1) { rows.push({ line, lines, name: o.package_name, error: "package_price differs between rows of the same package" }); continue }
    let before = null
    if (o.package_id) { before = all.find((g) => g.id === o.package_id && !g.archived); if (!before) { rows.push({ line, lines, name: o.package_name, error: `No package with id ${o.package_id}. Leave package_id blank to add a new package.` }); continue } }
    else before = all.find((g) => !g.archived && nameEn(g).toLowerCase() === clean(o.package_name).toLowerCase()) || null
    const blank = list.filter((r) => !clean(r.o.therapy))
    if (blank.length && list.length > 1) { rows.push({ line, lines, name: o.package_name, error: "A flexible package is one row with therapy blank. Otherwise fill therapy on every row." }); continue }
    const first = (k) => list.map((r) => r.o[k]).find((v) => clean(v)) ?? ""
    const raw = { code: first("package_code"), name: o.package_name, price: o.package_price, duration: first("duration"), validityMonths: first("validity_months"), inclusions: first("inclusions"),
      ...(blank.length ? { items: [], sessions: o.sessions } : { items: list.map((r) => ({ svc: r.o.therapy, n: r.o.sessions })) }) }
    const { d, error } = checkPackage(raw, { id: before?.id, all, therapies })
    if (error) { rows.push({ line, lines, name: o.package_name, error }); continue }
    const key = (g) => JSON.stringify([g.code ?? null, nameEn(g), g.price, g.items ?? [], g.sessions, g.duration ?? null, g.validityMonths ?? null, g.inclusions ?? []])
    const same = before && key(before) === key(d)
    rows.push({ line, lines, id: before?.id, name: d.name.en, action: !before ? "add" : same ? "same" : "update", d, before })
  }
  return { rows }
}

/** next free id with a prefix (t1, t2 … / g1, g2 …), never reused */
export const nextId = (prefix, list) => prefix + (Math.max(0, ...list.map((x) => (String(x.id).startsWith(prefix) ? Number(String(x.id).slice(prefix.length)) : 0) || 0)) + 1)
