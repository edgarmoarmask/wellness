// Staff attendance rules — same as the server's app/attendance.py. Times are clinic-local "HH:MM".
export const DEFAULT_ATT = { start: "09:00", end: "18:00", grace: 10, workdays: [1, 2, 3, 4, 5, 6] }   // ISO weekdays: Mon=1 … Sun=7
export const LEAVE_TYPES = { annual: "Annual leave", medical: "Medical leave", emergency: "Emergency leave", unpaid: "Unpaid leave", public: "Public holiday" }
export const WEEKDAYS = [[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"]]
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
export const mins = (t) => { const [h, m] = t.split(":"); return +h * 60 + +m }
const isoWeekday = (d) => { const w = new Date(d + "T00:00:00Z").getUTCDay(); return w === 0 ? 7 : w }
export const hours = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`

export function checkSettings(raw) {
  const start = String(raw.start ?? ""), end = String(raw.end ?? "")
  if (!HHMM.test(start) || !HHMM.test(end)) return { error: "Shift start and end should be times like 09:00" }
  if (mins(end) <= mins(start)) return { error: "Shift end must be after shift start" }
  const grace = Number(raw.grace)
  if (!Number.isInteger(grace)) return { error: "Grace minutes should be a whole number" }
  if (grace < 0 || grace > 120) return { error: "Grace minutes should be between 0 and 120" }
  const workdays = [...new Set((raw.workdays ?? []).map(Number))].sort()
  if (!workdays.length || workdays.some((d) => d < 1 || d > 7)) return { error: "Choose at least one working day" }
  return { d: { start, end, grace, workdays } }
}
export function checkTimes(tin, tout) {
  if (!tin || !HHMM.test(tin)) return "Enter the clock-in time, like 09:00"
  if (tout && !HHMM.test(tout)) return "Clock-out time should look like 18:00"
  if (tout && mins(tout) <= mins(tin)) return "Clock-out must be after clock-in"
  return null
}

/** one person's entries on `day` → { status: leave|late|present|absent|not_in|off, first, last, minutes, clockedIn, missingOut, leaveType, lateBy } */
export function dayStatus(entries, day, today, now, cfg, since = null) {
  const leave = entries.find((e) => e.kind === "leave")
  const work = entries.filter((e) => e.kind === "work" && e.in).sort((a, b) => a.in.localeCompare(b.in))
  const minutes = work.filter((e) => e.out).reduce((a, e) => a + mins(e.out) - mins(e.in), 0)
  const open = work.filter((e) => !e.out), missingOut = open.length > 0 && day < today
  const first = work[0]?.in ?? null, late = !!first && mins(first) > mins(cfg.start) + Number(cfg.grace)
  const workday = cfg.workdays.includes(isoWeekday(day))
  const status = leave ? "leave" : work.length ? (late ? "late" : "present") : since && day < since ? "before" : !workday ? "off" : day > today || (day === today && mins(now) < mins(cfg.end)) ? "not_in" : "absent"
  const outs = work.filter((e) => e.out).map((e) => e.out).sort()
  return { status, first, last: outs.length ? outs[outs.length - 1] : null, minutes, clockedIn: open.length > 0 && day === today, missingOut, leaveType: leave ? leave.leaveType : null, lateBy: late ? Math.max(0, mins(first) - mins(cfg.start)) : 0 }
}
export function daysBetween(a, b) { const out = []; for (let d = new Date(a + "T00:00:00Z"); d <= new Date(b + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out }
/** since: { userId: "YYYY-MM-DD" } — no absences counted before someone joined */
export function summary(entries, userIds, start, end, today, now, cfg, since = {}) {
  const out = {}, days = daysBetween(start, end).filter((d) => d <= today)
  for (const uid of userIds) {
    const mine = entries.filter((e) => e.userId === uid), r = { present: 0, late: 0, absent: 0, leave: {}, minutes: 0, missingOut: 0 }
    for (const d of days) {
      const st = dayStatus(mine.filter((e) => e.date === d), d, today, now, cfg, since[uid] ?? null)
      if (st.status === "present" || st.status === "late") r.present++
      if (st.status === "late") r.late++
      if (st.status === "absent") r.absent++
      if (st.status === "leave") r.leave[st.leaveType] = (r.leave[st.leaveType] ?? 0) + 1
      r.minutes += st.minutes; if (st.missingOut) r.missingOut++
    }
    out[uid] = r
  }
  return out
}
export const STATUS = { present: ["Present", "ok"], late: ["Late", "warn"], leave: ["On leave", "info"], absent: ["Absent", "danger"], not_in: ["Not yet in", "muted"], off: ["Day off", "muted"], before: ["Not on staff yet", "muted"] }
