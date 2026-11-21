// Dashboard — every figure is computed from records entered in the system (no sample history).
import { useState } from "react"
import { Users, Wallet, Timer, FileClock, Flower2, Sparkles, CalendarClock, AlertTriangle, ArrowRight, Stethoscope, HeartPulse, Pill, Receipt, Landmark, UserPlus } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { PageHead, Kpi, LineChart, Donut, HBars, IconChip } from "@/components/kit"
import { useLang } from "@/lib/i18n"
import { useStore, isToday, CASH_ACCOUNTS } from "@/lib/store"
import { rm, rm0, num, cn } from "@/lib/utils"
import { UNITS, CLINIC } from "@data/clinic.js"
import { ageDays, iso } from "@data/util.js"
import { pkgOf, packageState } from "@/lib/rules"

const lastDays = (n, offset = 0) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - offset - (n - 1 - i)); return iso(d) })

export default function Dashboard({ go }) {
  const { day } = useLang(); const { S } = useStore()
  const [unit, setUnit] = useState("all"); const [range, setRange] = useState(30); const [ask, setAsk] = useState(null)
  const inUnit = (u) => unit === "all" || u === unit
  const days = lastDays(range), prevDays = lastDays(range, range)
  const arrived = (v) => !["booked", "cancelled"].includes(v.status)
  const visits = S.Q.filter((v) => inUnit(v.unit) && arrived(v))
  const perDay = days.map((d) => visits.filter((v) => v.date === d).length)
  const pts = perDay.reduce((a, b) => a + b, 0), prev = visits.filter((v) => prevDays.includes(v.date)).length, chg = prev ? ((pts - prev) / prev) * 100 : 0
  // money received = invoices paid + package payments (packages belong to the therapy unit)
  const pkPay = S.PK.flatMap((k) => k.payments.map((p) => ({ date: p.date, amt: p.amt, unit: "tx" })))
  const invPaid = S.INVC.map((i) => ({ date: i.date, amt: i.total, unit: i.unit }))
  const all = [...invPaid, ...pkPay].filter((m) => days.includes(m.date))
  const rev = all.filter((m) => inUnit(m.unit)).reduce((a, m) => a + (m.amt || 0), 0)
  const revByUnit = UNITS.map((u) => [u.short.en, all.filter((m) => m.unit === u.id).reduce((a, m) => a + (m.amt || 0), 0), u.id === "opd" ? "#5b2ef0" : "#1f7a3f"])
  const waits = visits.filter((v) => v.unit === "opd" && v.checkedInAt && v.startedAt && days.includes(v.date)).map((v) => (new Date(v.startedAt) - new Date(v.checkedInAt)) / 60000)
  const wait = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0
  const sessions = S.PK.reduce((a, k) => a + (k.log || []).filter((d) => days.includes(d)).length, 0)
  const done = visits.filter((v) => v.status === "done" && days.includes(v.date))
  const mix = done.reduce((m, v) => { const k = v.pk && S.PK.find((z) => z.id === v.pk); if (!k) m.self++; else if (k.plan === "full") m.full++; else m.part++; return m }, { self: 0, full: 0, part: 0 })
  const due = S.PK.map(packageState).filter((s) => s.balance > 0), out = due.reduce((a, s) => a + s.balance, 0), overdue = due.filter((s) => s.overdue)
  const live = S.INV.filter((i) => !i.archived), low = live.filter((i) => i.stock < i.reorder), exp = live.filter((i) => i.exp && ageDays(i.exp) > -60)
  const todayQ = S.Q.filter((v) => inUnit(v.unit) && isToday(v.date) && v.status !== "cancelled"), waiting = todayQ.filter((v) => v.status === "waiting").length
  const collected = S.J.filter((e) => isToday(e.date) && CASH_ACCOUNTS.includes(e.dr)).reduce((a, e) => a + e.amt, 0)
  const renew = S.PK.filter((k) => packageState(k).left === 1).map((k) => S.P.find((p) => p.id === k.pid)?.name)
  const newPts = S.P.filter((p) => p.created && days.includes(p.created.slice(0, 10))).length
  const busiest = (() => { const byWd = [0, 0, 0, 0, 0, 0, 0]; visits.filter((v) => days.includes(v.date)).forEach((v) => byWd[new Date(v.date).getDay()]++); const top = byWd.indexOf(Math.max(...byWd)); return pts ? `${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][top]} is the busiest day in this period with ${byWd[top]} visit(s). Plan therapist rosters and follow-up slots around it.` : "No visits recorded in this period yet. Answers appear once visits are entered." })()
  const asks = [
    ["busy", "Which days are busiest?", busiest],
    ["bal", "Which package balances should we collect?", due.length ? `${due.length} client(s) owe ${rm(out)} in package balances. ${overdue.length ? `${overdue.length} are past 30 days: call or WhatsApp them before their next session.` : "None is overdue."} Sessions stay locked until the paid amount covers them.` : "No package balances outstanding."],
    ["pkg", "How are packages doing?", `${num(sessions)} package session(s) delivered in this period. ${renew.length ? `${renew.join(", ")} has 1 session left: a good moment to offer a renewal.` : "No client is on their last session."}`],
  ]
  const tiles = [["patients", Users, "Patients", "violet"], ["appointments", CalendarClock, "Queue", "blue", waiting], ["consult", Stethoscope, "Consultation", "herb"], ["packages", Flower2, "Packages", "pink"], ["pharmacy", Pill, "Pharmacy", "gold", S.Q.filter((v) => v.status === "dispense").length],
    ["billing", Receipt, "Billing", "amber", S.Q.filter((v) => v.status === "billing").length], ["accounts", Landmark, "Accounts", "blue"], ["assistant", Sparkles, "AI assistant", "violet"]]
  return (
    <div className="grid gap-5">
      <PageHead icon={HeartPulse} tone="herb" title="Dashboard" sub={`${CLINIC.name} · ${CLINIC.location}`}
        right={<><NativeSelect value={unit} onChange={(e) => setUnit(e.target.value)} className="w-56" aria-label="Unit"><option value="all">Whole centre</option>{UNITS.map((u) => <option key={u.id} value={u.id}>{u.name.en}</option>)}</NativeSelect>
          <div className="flex rounded-full border bg-white p-1">{[7, 30, 90].map((r) => <button key={r} onClick={() => setRange(r)} aria-pressed={range === r} className={cn("cursor-pointer rounded-full px-3 py-1 text-xs font-bold", range === r ? "ln-grad text-white" : "text-muted-foreground")}>{r} days</button>)}</div></>} />
      {S.P.length === 0 && <Card className="border-herb/30 bg-herb-soft/50"><CardContent className="flex flex-wrap items-center gap-4 p-5"><IconChip icon={UserPlus} tone="herb" size="lg" /><div className="min-w-0 flex-1"><b>Start by registering your patients.</b><p className="text-sm text-muted-foreground">The dashboard fills in automatically from the visits, packages and payments you record.</p></div><Button variant="herb" onClick={() => go("patients")}>Go to Patients<ArrowRight /></Button></CardContent></Card>}
      <div className="grid grid-cols-4 gap-2 md:grid-cols-8">{tiles.map(([k, Icon, l, tone, b]) => <button key={k} onClick={() => go(k)} className="ln-shadow relative grid min-w-0 cursor-pointer justify-items-center gap-2 rounded-2xl border bg-white px-1 py-3 text-center transition hover:-translate-y-0.5 hover:border-primary">{b > 0 && <span className="absolute top-1.5 right-1.5 grid min-w-5 place-items-center rounded-full bg-warn px-1 text-[11px] font-bold text-white">{b}</span>}<IconChip icon={Icon} tone={tone} size="lg" /><span className="text-[11px] leading-tight font-semibold md:text-xs">{l}</span></button>)}</div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi icon={Users} tone="violet" label="Visits" value={num(pts)} sub={prev ? `${chg >= 0 ? "▲" : "▼"} ${Math.abs(chg).toFixed(1)}% vs previous period` : `${newPts} new patient(s) registered`} trend={prev ? (chg >= 0 ? "up" : "down") : undefined} />
        <Kpi icon={Wallet} tone="herb" label="Money received" value={rm0(rev)} sub="Visits, medicines and package payments" />
        <Kpi icon={Timer} tone="cyan" label="Average wait (consultation)" value={waits.length ? `${Math.round(wait)} min` : "—"} sub="Check-in to start of consultation" />
        <Kpi icon={FileClock} tone="amber" label="Package balances to collect" value={rm(out)} sub={`${due.length} client(s) · ${overdue.length} overdue`} />
        <Kpi icon={Flower2} tone="pink" label="Package sessions" value={num(sessions)} sub="Delivered in this period" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card><CardHeader><CardTitle>Visits per day</CardTitle></CardHeader><CardContent><LineChart series={perDay} labels={days.map((d) => day(d))} /></CardContent></Card>
        <Card><CardHeader><CardTitle>How clients pay (completed visits)</CardTitle></CardHeader><CardContent>{done.length ? <Donut parts={[["Pay per visit", mix.self, "#5b2ef0"], ["Package paid in full", mix.full, "#1f7a3f"], ["Package on part payment", mix.part, "#b8860b"]]} /> : <p className="text-sm text-muted-foreground">No completed visits in this period yet.</p>}</CardContent></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card><CardHeader><CardTitle>Money received by unit</CardTitle></CardHeader><CardContent><HBars items={revByUnit} fmt={rm0} /></CardContent></Card>
        <Card><CardHeader><CardTitle>Today</CardTitle></CardHeader><CardContent className="grid gap-3">
          <div className="grid grid-cols-3 gap-2 text-center">{[[todayQ.length, "booked & walk-ins"], [waiting, "waiting now"], [rm(collected), "collected so far"]].map(([v, l]) => <div key={l} className="rounded-xl bg-muted p-3"><b className="font-display text-lg">{v}</b><div className="text-[11px] text-muted-foreground">{l}</div></div>)}</div>
          <Button variant="outline" onClick={() => go("appointments")}>Open the queue<ArrowRight /></Button></CardContent></Card>
        <Card><CardHeader><CardTitle><AlertTriangle className="size-4 text-warn" />Stock alerts</CardTitle></CardHeader><CardContent className="grid gap-2">
          {low.map((i) => <div key={i.id} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{i.name}</span><Badge variant="danger">{i.stock} left</Badge></div>)}
          {exp.map((i) => <div key={i.id + "e"} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{i.name}</span><Badge variant="warn">expires in {-ageDays(i.exp)} days</Badge></div>)}
          {!low.length && !exp.length && <p className="text-sm text-muted-foreground">No stock alerts.</p>}
          <Button variant="outline" className="mt-1" onClick={() => go("pharmacy")}>Open pharmacy<ArrowRight /></Button></CardContent></Card>
      </div>
      <Card className="border-primary/20 bg-gradient-to-br from-white to-accent/40"><CardHeader><CardTitle><Sparkles className="size-4 text-primary" />Ask your centre's data</CardTitle></CardHeader>
        <CardContent className="grid gap-3"><div className="flex flex-wrap gap-2">{asks.map(([k, q]) => <button key={k} onClick={() => setAsk(k)} aria-pressed={ask === k} className={cn("cursor-pointer rounded-full border px-3 py-1.5 text-left text-sm font-semibold", ask === k ? "border-transparent ln-grad text-white" : "border-border bg-white hover:border-primary")}>{q}</button>)}</div>
          {ask ? <p className="rounded-xl bg-white p-4 text-sm leading-relaxed">{asks.find((a) => a[0] === ask)[2]}</p> : <p className="text-sm text-muted-foreground">Pick a question to see your numbers explained.</p>}</CardContent></Card>
    </div>)
}
