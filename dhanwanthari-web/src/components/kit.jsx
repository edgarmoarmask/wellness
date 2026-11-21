import { cn, num } from "@/lib/utils"
import { useLang } from "@/lib/i18n"
import { Badge } from "@/components/ui/badge"

export const TONES = { violet: ["#efeafe", "#5b2ef0"], herb: ["#e5f3ea", "#1f7a3f"], gold: ["#fbf3dc", "#9a6f00"], cyan: ["#e0f6fd", "#0891b2"], amber: ["#fdf1dc", "#d97706"], pink: ["#fde7f1", "#db2777"], blue: ["#e6eeff", "#2563eb"], red: ["#fee2e2", "#dc2626"] }
export function IconChip({ icon: Icon, tone = "violet", size = "md" }) {
  const [bg, fg] = TONES[tone]; const box = size === "lg" ? "size-12 rounded-2xl" : size === "sm" ? "size-8 rounded-lg" : "size-10 rounded-xl"
  return <span className={cn("grid shrink-0 place-items-center", box)} style={{ background: bg, color: fg }}><Icon className={size === "lg" ? "size-6" : size === "sm" ? "size-4" : "size-5"} /></span>
}
export function PageHead({ icon, tone = "violet", title, sub, right }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {icon && <IconChip icon={icon} tone={tone} size="lg" />}
      <div className="min-w-0 flex-1"><h1 className="text-2xl font-bold md:text-3xl">{title}</h1>{sub && <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>}</div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>)
}
export function Kpi({ icon, tone = "violet", label, value, sub, trend }) {
  return (
    <div className="ln-shadow flex items-center gap-3 rounded-2xl border bg-white p-4">
      {icon && <IconChip icon={icon} tone={tone} size="lg" />}
      <div className="min-w-0"><div className="font-display text-2xl leading-none font-bold">{value}</div><div className="mt-1 text-xs text-muted-foreground">{label}</div>
        {sub && <div className={cn("mt-0.5 text-[11px]", trend === "up" ? "font-semibold text-ok" : trend === "down" ? "font-semibold text-destructive" : "text-muted-foreground")}>{sub}</div>}</div>
    </div>)
}
const ST = {
  booked: ["muted", "Booked", "Ditempah"], waiting: ["warn", "Waiting", "Menunggu"], consult: ["info", "With Vaidya / therapist", "Bersama Vaidya / ahli terapi"],
  dispense: ["info", "At pharmacy", "Di farmasi"], billing: ["danger", "To pay", "Untuk bayar"], done: ["ok", "Done", "Selesai"],
  cancelled: ["muted", "Cancelled", "Dibatalkan"], paid: ["ok", "Paid", "Dibayar"], pending: ["warn", "Pending", ""], failed: ["danger", "Failed", ""],
}
export function Status({ s }) { const { x } = useLang(); const [v, en, ms] = ST[s] || ST.booked; return <Badge variant={v}><span className="size-1.5 rounded-full bg-current" />{x(en, ms)}</Badge> }

export function LineChart({ series, labels, color = "#5b2ef0" }) {
  const W = 640, H = 200, pad = 30, max = Math.max(...series, 4) * 1.15, n = series.length
  const X = (i) => pad + ((W - pad * 2) * (n === 1 ? 0 : i / (n - 1))), Y = (v) => H - pad - ((H - pad * 2) * v) / max
  const d = series.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ")
  const step = Math.max(1, Math.round(n / 6))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Line chart">
      {[0.25, 0.5, 0.75, 1].map((f) => { const yy = Y((max / 1.15) * f); return <g key={f}><line x1={pad} x2={W - pad} y1={yy} y2={yy} stroke="var(--border)" /><text x="2" y={yy + 4} fontSize="10" fill="var(--muted-foreground)">{num((max / 1.15) * f)}</text></g> })}
      <path d={`${d} L${X(n - 1)} ${H - pad} L${X(0)} ${H - pad} Z`} fill={color} opacity=".1" /><path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
      {labels.map((l, i) => (i % step === 0 ? <text key={i} x={X(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted-foreground)">{l}</text> : null))}
    </svg>)
}
export function HBars({ items, fmt }) {
  const max = Math.max(...items.map((i) => i[1]), 1)
  return <div className="grid gap-3">{items.map(([label, v, col]) => <div key={label} className="grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-3 text-sm"><span className="truncate">{label}</span><div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(v / max) * 100}%`, background: col }} /></div><b className="text-xs">{fmt(v)}</b></div>)}</div>
}
export function Donut({ parts }) {
  const tot = parts.reduce((a, p) => a + p[1], 0) || 1, R = 62, r = 40, c = 80; let a0 = -Math.PI / 2
  const f = (rr, a) => `${(c + rr * Math.cos(a)).toFixed(2)} ${(c + rr * Math.sin(a)).toFixed(2)}`
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 160 160" width="150" height="150" role="img" aria-label="Payer mix">{parts.map(([, v, col], i) => { if (v <= 0) return null; const a1 = a0 + (2 * Math.PI * v) / tot, large = a1 - a0 > Math.PI ? 1 : 0; const el = v / tot > 0.999 ? <circle key={i} cx="80" cy="80" r="51" fill="none" stroke={col} strokeWidth="22" /> : <path key={i} d={`M${f(R, a0)} A${R} ${R} 0 ${large} 1 ${f(R, a1)} L${f(r, a1)} A${r} ${r} 0 ${large} 0 ${f(r, a0)} Z`} fill={col} />; a0 = a1; return el })}</svg>
      <ul className="grid gap-2 text-sm">{parts.map(([l, v, col]) => <li key={l} className="flex items-center gap-2"><i className="size-3 rounded-sm" style={{ background: col }} />{l}<b className="ml-2">{Math.round((v / tot) * 100)}%</b></li>)}</ul>
    </div>)
}

/** <option>s for therapy services grouped as on the price list (Wellness offer / Walk-in treatment). Deleted (archived) services are left out. */
export function ServiceOptions({ list: all, rm }) {
  const ORDER = ["Wellness offer", "Walk-in treatment"]
  const list = all.filter((s) => !s.archived).sort((a, b) => (ORDER.indexOf(a.group) + 1 || 9) - (ORDER.indexOf(b.group) + 1 || 9) || a.name.en.localeCompare(b.name.en))
  const groups = [...new Set(list.map((s) => s.group ?? "Services"))]
  return groups.map((g) => <optgroup key={g} label={g}>{list.filter((s) => (s.group ?? "Services") === g).map((s) => <option key={s.id} value={s.id}>{s.code ? `${s.code} · ` : ""}{s.name.en} · {rm(s.price)}</option>)}</optgroup>)
}

/** next quarter hour from now as "HH:MM" (09:00 if before opening) */
export const nextSlot = () => { const d = new Date(), m = Math.ceil((d.getHours() * 60 + d.getMinutes() + 1) / 15) * 15, t = Math.max(m, 9 * 60); return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}` }

/** Walk-in now, or an appointment on a chosen day and time. Shows the day in words and any problem before booking. */
export function WhenPicker({ kind, setKind, date, setDate, time, setTime, error }) {
  const today = new Date(), iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  const max = new Date(today); max.setDate(max.getDate() + 365)
  const label = date ? new Date(date + "T00:00").toLocaleDateString("en-MY", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : ""
  const quick = [0, 1, 2, 7].map((n) => { const d = new Date(today); d.setDate(d.getDate() + n); return [iso(d), n === 0 ? "Today" : n === 1 ? "Tomorrow" : n === 7 ? "In 1 week" : d.toLocaleDateString("en-MY", { weekday: "short" })] })
  return (<>
    <div className="grid grid-cols-2 gap-2">{[["walkin", "Arrived now (walk-in)"], ["appt", "Book an appointment"]].map(([k, l]) => <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={cn("cursor-pointer rounded-xl border p-3 text-sm font-semibold", kind === k ? "border-primary bg-accent text-primary" : "")}>{l}</button>)}</div>
    {kind === "appt" && <div className="grid gap-2 rounded-xl border bg-muted/30 p-3">
      <div className="flex flex-wrap gap-1.5">{quick.map(([d, l]) => <button key={d} type="button" onClick={() => setDate(d)} aria-pressed={date === d} className={cn("cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold", date === d ? "border-primary bg-accent text-primary" : "bg-white")}>{l}</button>)}</div>
      <div className="grid grid-cols-2 gap-2"><label className="grid gap-1 text-sm font-semibold">Day<input type="date" className="h-10 rounded-xl border bg-white px-3 text-sm font-normal" min={iso(today)} max={iso(max)} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="grid gap-1 text-sm font-semibold">Time<input type="time" className="h-10 rounded-xl border bg-white px-3 text-sm font-normal" min="08:00" max="20:00" step="900" value={time} onChange={(e) => setTime(e.target.value)} /></label></div>
      {label && <span className="text-xs text-muted-foreground">{label}{time ? ` at ${time}` : ""}</span>}
      {error && <span className="text-xs font-semibold text-destructive" role="alert">{error}</span>}</div>}
  </>)
}
