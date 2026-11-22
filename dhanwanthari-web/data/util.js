// Date helpers shared by the mock data. "Today" is the real current date so the demo always looks live.
export const TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })()
export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
export const daysAgo = (n) => { const d = new Date(TODAY); d.setDate(d.getDate() - n); return d }
export const daysFromToday = (n) => iso(daysAgo(-n))
export const ageDays = (isoDate) => Math.round((TODAY - new Date(isoDate + "T00:00:00")) / 864e5)
// deterministic pseudo-random so charts look the same on every load
export const rnd = (seed) => { let s = seed; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280 } }
