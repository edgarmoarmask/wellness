// Operational records start EMPTY: no visits, packages sold, invoices or journal entries.
// Everything is created by staff using the app (and, in production, stored by the API).
// Visit status: booked → waiting → consult → dispense → billing → done
export const QUEUE = []
// Client packages: { id, pid, pkg, used, sold, plan: "full" | "partial", payments: [{ date, amt, method }], log: [session dates] }
export const CLIENT_PACKAGES = []
export const INVOICES = []
export const JOURNAL = []
// Money in / money out (Accounting → Transactions). Starts empty.
export const TRANSACTIONS = []
