// Staff users: role → pages, checks for the users form (same messages as the server, app/routers/users.py).
import { ROLES } from "@data/users.js"

export const ROLE_INFO = {
  admin: "Everything, including Administration (users), therapy menu & package prices, SST settings and opening balances.",
  bams: "Consultations, prescriptions, dispensing, pharmacy & stock.",
  therapist: "Therapy sessions and package sessions.",
  cashier: "Registration, queue & appointments, billing, package sales, payments & expenses, accounting reports.",
}
const ALL = ["dashboard", "patients", "appointments", "consult", "packages", "pharmacy", "billing", "acc-transactions", "acc-reports", "acc-ledger", "acc-sst", "acc-downloads", "acc-coa", "assistant", "attendance", "admin-users"]
const ACC = ["acc-transactions", "acc-reports", "acc-ledger", "acc-sst", "acc-downloads", "acc-coa"]
export const ROLE_PAGES = {
  admin: ALL,
  bams: ["dashboard", "patients", "appointments", "consult", "packages", "pharmacy", "assistant", "attendance"],
  therapist: ["dashboard", "patients", "appointments", "consult", "packages", "assistant", "attendance"],
  cashier: ["dashboard", "patients", "appointments", "packages", "billing", ...ACC, "assistant", "attendance"],
}
/** older roles from earlier versions */
const OLD = { vaidya: "bams", pharmacist: "bams", front: "cashier", finance: "cashier" }
export const normRole = (r) => OLD[r] ?? r
export const canSee = (role, page) => (ROLE_PAGES[normRole(role)] ?? ROLE_PAGES.cashier).includes(page)
export const roleLabel = (r) => ROLES[normRole(r)]?.en ?? r

export function checkPassword(pw) {
  if (String(pw ?? "").length < 10 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Password needs at least 10 characters, with letters and numbers."
  return null
}
export function checkUser({ name, email, role }) {
  const n = String(name ?? "").trim().replace(/\s+/g, " "), e = String(email ?? "").trim().toLowerCase(), r = String(role ?? "").trim().toLowerCase()
  if (n.length < 2) return { error: "Enter the person's name" }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { error: "Enter a valid email address" }
  if (!ROLES[r]) return { error: `Role must be one of: ${Object.values(ROLES).map((x) => x.en).join(", ")}` }
  return { d: { name: n, email: e, role: r } }
}
/** readable temporary password: 3 words-ish chunks + digits, meets the rule */
export function tempPassword() {
  const a = "abcdefghjkmnpqrstuvwxyz", A = "ABCDEFGHJKMNPQRSTUVWXYZ", buf = new Uint32Array(12); crypto.getRandomValues(buf)
  const pick = (s, i) => s[buf[i] % s.length]
  return pick(A, 0) + [1, 2, 3, 4, 5].map((i) => pick(a, i)).join("") + "-" + [6, 7, 8, 9].map((i) => String(buf[i] % 10)).join("") + pick(A, 10) + pick(a, 11)
}
export async function demoHash(pw) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("dvc-demo:" + pw))
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("")
}
