// Staff attendance: clock in/out for everyone; daily register, summary, corrections, leave and settings for admins.
import { useCallback, useEffect, useMemo, useState } from "react"
import { Clock, LogIn, LogOut, CalendarDays, Plus, Pencil, Trash2, Download, Settings2, Users } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input, NativeSelect, Label } from "@/components/ui/input"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Table, THead, TR, TH, TD } from "@/components/ui/table"
import { PageHead } from "@/components/kit"
import { useStore } from "@/lib/store"
import { roleLabel } from "@/lib/users"
import { LEAVE_TYPES, WEEKDAYS, STATUS, dayStatus, hours, checkTimes, checkSettings, mins } from "@/lib/attendance"
import { saveBlob } from "./Accounting"
import { cn } from "@/lib/utils"

const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const todayIso = () => isoOf(new Date())
const shift = (iso, n) => { const d = new Date(iso + "T00:00"); d.setDate(d.getDate() + n); return isoOf(d) }
const nice = (iso) => new Date(iso + "T00:00").toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
const Err = ({ children }) => (children ? <p className="text-sm font-semibold text-destructive" role="alert">{children}</p> : null)
function StatusBadge({ st }) {
  const [label, tone] = STATUS[st.status]
  return <Badge variant={tone}>{st.status === "late" ? `Late ${st.lateBy} min` : st.status === "leave" ? LEAVE_TYPES[st.leaveType] ?? label : label}</Badge>
}

/** header pill: Clock in / On duty since … · Clock out */
export function ClockButton({ me }) {
  const st = useStore(), [t, setT] = useState(null), [busy, setBusy] = useState(false)
  const load = useCallback(async () => setT(await st.attToday(me)), [st.mode, me?.email, st.S.ATT])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])
  if (!t) return null
  const on = t.status.clockedIn, open = t.entries.filter((e) => e.kind === "work" && !e.out).at(-1)
  const go = async () => { setBusy(true); await (on ? st.clockOut(me) : st.clockIn(me)); setBusy(false); load() }
  return <button onClick={go} disabled={busy} title={on ? "Clock out" : "Clock in"} className={cn("flex h-10 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm font-semibold shadow-sm", on ? "border-herb bg-herb-soft text-herb" : "bg-white hover:border-primary hover:text-primary")}>
    {on ? <><Clock className="size-4" />On duty since {open?.in}<span className="font-normal text-muted-foreground">· Clock out</span></> : <><LogIn className="size-4" />Clock in{t.status.minutes > 0 ? <span className="font-normal text-muted-foreground">· {hours(t.status.minutes)} today</span> : null}</>}
  </button>
}

function EntryDialog({ mode, staff, entry, day, onClose, onDone }) {
  const st = useStore(), edit = !!entry
  const [userId, setUserId] = useState(entry?.userId ?? staff[0]?.id ?? ""), [kind, setKind] = useState(entry?.kind ?? (mode === "leave" ? "leave" : "work"))
  const [date, setDate] = useState(entry?.date ?? day), [toDate, setToDate] = useState(day)
  const [tin, setTin] = useState(entry?.in ?? "09:00"), [tout, setTout] = useState(entry?.out ?? "18:00"), [leaveType, setLeaveType] = useState(entry?.leaveType ?? "annual")
  const [note, setNote] = useState(entry?.note ?? ""), [reason, setReason] = useState(""), [err, setErr] = useState("")
  const chk = kind === "work" ? checkTimes(tin, tout) : null
  const save = async (e) => {
    e.preventDefault()
    const r = edit ? await st.attEdit(entry.id, { timeIn: tin, timeOut: tout, leaveType, note, reason }) : await st.attAdd({ userId, date, toDate: kind === "leave" ? toDate : undefined, kind, timeIn: tin, timeOut: tout, leaveType, note })
    if (r) return setErr(r); onDone(); onClose()
  }
  const who = staff.find((u) => u.id === userId)
  return <DialogContent title={edit ? `Correct entry · ${who?.name ?? ""}` : kind === "leave" ? "Record leave" : "Add work time"} description={edit ? `${nice(entry.date)} · the reason is kept in the audit log` : "For a missed clock-in, or leave and public holidays."}>
    <form onSubmit={save} className="grid gap-3">
      {!edit && <><Label>Staff member<NativeSelect value={userId} onChange={(e) => setUserId(e.target.value)}>{staff.map((u) => <option key={u.id} value={u.id}>{u.name} · {roleLabel(u.role)}</option>)}</NativeSelect></Label>
        <div className="grid grid-cols-2 gap-2">{[["work", "Work time"], ["leave", "Leave"]].map(([k, l]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setErr("") }} className={cn("cursor-pointer rounded-xl border p-2.5 text-sm font-semibold", kind === k ? "border-primary bg-accent text-primary" : "")}>{l}</button>)}</div></>}
      {!edit && <div className="grid grid-cols-2 gap-3"><Label>{kind === "leave" ? "From" : "Day"}<Input type="date" value={date} max={kind === "work" ? todayIso() : undefined} onChange={(e) => { setDate(e.target.value); if (toDate < e.target.value) setToDate(e.target.value) }} /></Label>
        {kind === "leave" && <Label>To<Input type="date" value={toDate} min={date} onChange={(e) => setToDate(e.target.value)} /></Label>}</div>}
      {kind === "work" ? <div className="grid grid-cols-2 gap-3"><Label>Clock in<Input type="time" value={tin} onChange={(e) => { setTin(e.target.value); setErr("") }} /></Label><Label>Clock out<Input type="time" value={tout ?? ""} onChange={(e) => { setTout(e.target.value); setErr("") }} /></Label></div>
        : <Label>Leave type<NativeSelect value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>{Object.entries(LEAVE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Label>}
      <Label>Note<Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "leave" ? "e.g. MC from Klinik Kesihatan" : "e.g. forgot to clock in"} /></Label>
      {edit && <Label>Reason for the correction *<Input value={reason} onChange={(e) => { setReason(e.target.value); setErr("") }} placeholder="e.g. checked with the staff member" /></Label>}
      <Err>{err || chk}</Err>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!!chk || (edit && reason.trim().length < 3)}>{edit ? "Save correction" : kind === "leave" ? "Record leave" : "Add entry"}</Button></div>
    </form></DialogContent>
}

function DeleteEntry({ entry, onClose, onDone }) {
  const st = useStore(), [reason, setReason] = useState(""), [err, setErr] = useState("")
  return <DialogContent title="Delete this entry?" description={`${nice(entry.date)} · ${entry.kind === "leave" ? LEAVE_TYPES[entry.leaveType] : `${entry.in}–${entry.out ?? "…"}`}`}>
    <Label>Reason *<Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. entered for the wrong person" /></Label><Err>{err}</Err>
    <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="destructive" disabled={reason.trim().length < 3} onClick={async () => { const e = await st.attDelete(entry.id, reason); if (e) return setErr(e); onDone(); onClose() }}><Trash2 />Delete</Button></div></DialogContent>
}

function SettingsCard({ cfg, onDone }) {
  const st = useStore(), [f, setF] = useState(cfg), [err, setErr] = useState("")
  useEffect(() => setF(cfg), [cfg])
  const chk = checkSettings(f).error
  return <Card><CardHeader><CardTitle><Settings2 className="size-4" />Shift settings</CardTitle></CardHeader><CardContent className="grid gap-3">
    <div className="grid gap-3 sm:grid-cols-3"><Label>Shift starts<Input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Label><Label>Shift ends<Input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Label>
      <Label>Grace (minutes before "late")<Input inputMode="numeric" value={f.grace} onChange={(e) => setF({ ...f, grace: e.target.value })} /></Label></div>
    <div className="grid gap-1.5"><span className="text-sm font-semibold">Working days</span><div className="flex flex-wrap gap-1.5">{WEEKDAYS.map(([d, l]) => { const on = f.workdays.map(Number).includes(d); return <button key={d} type="button" aria-pressed={on} onClick={() => setF({ ...f, workdays: on ? f.workdays.filter((x) => Number(x) !== d) : [...f.workdays, d] })} className={cn("cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold", on ? "border-primary bg-accent text-primary" : "bg-white")}>{l}</button> })}</div>
      <span className="text-xs text-muted-foreground">No clock-in on a working day after the shift ends counts as absent (unless on leave).</span></div>
    <Err>{err || chk}</Err><div><Button disabled={!!chk} onClick={async () => { const e = await st.attSettings(f); if (e) return setErr(e); onDone() }}>Save settings</Button></div></CardContent></Card>
}

export function Attendance({ me }) {
  const st = useStore(), admin = me.role === "admin"
  const [tab, setTab] = useState("day"), [day, setDay] = useState(todayIso)
  const [range, setRange] = useState(() => { const t = todayIso(); return { from: t.slice(0, 8) + "01", to: t } })
  const [reg, setReg] = useState(null), [dlg, setDlg] = useState(null), [del, setDel] = useState(null), [mine, setMine] = useState(null)
  const q = tab === "day" ? { from: day, to: day } : range
  const load = useCallback(async () => { setReg(await st.attRegister(q, me)); setMine(await st.attToday(me)) }, [st.mode, q.from, q.to, me.email, st.S.ATT, st.S.ATTSET])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])
  const presets = useMemo(() => { const t = todayIso(), d = new Date(t + "T00:00"), mon = shift(t, -((d.getDay() + 6) % 7)); const lm = new Date(d.getFullYear(), d.getMonth() - 1, 1)
    return [["This week", mon, t], ["This month", t.slice(0, 8) + "01", t], ["Last month", isoOf(lm), isoOf(new Date(d.getFullYear(), d.getMonth(), 0))]] }, [])
  if (!reg || !mine) return <p className="p-6 text-sm text-muted-foreground">Loading…</p>
  if (reg.error) return <p className="p-6 text-sm text-destructive">{reg.error}</p>
  const cfg = reg.settings, staff = reg.users, by = (uid, d) => reg.entries.filter((e) => e.userId === uid && e.date === d)
  const exportCsv = () => {
    const rows = [["Date", "Staff", "Role", "Status", "Clock in", "Clock out", "Hours", "Leave", "Note", "Source"]]
    for (const e of reg.entries) { const u = staff.find((x) => x.id === e.userId); const m = e.kind === "work" && e.out ? mins(e.out) - mins(e.in) : 0
      rows.push([e.date, u?.name ?? e.userId, roleLabel(u?.role), e.kind === "leave" ? "Leave" : e.out ? "Worked" : "No clock-out", e.in ?? "", e.out ?? "", e.kind === "work" ? (m / 60).toFixed(2) : "", e.kind === "leave" ? LEAVE_TYPES[e.leaveType] : "", e.note ?? "", e.source]) }
    rows.push([], ["Summary " + q.from + " to " + q.to], ["Staff", "Role", "Days present", "Late", "Absent", "Leave days", "Hours", "Missing clock-out"])
    for (const u of staff) { const s = reg.summary[u.id]; rows.push([u.name, roleLabel(u.role), s.present, s.late, s.absent, Object.values(s.leave).reduce((a, b) => a + b, 0), (s.minutes / 60).toFixed(2), s.missingOut]) }
    const csv = "﻿" + rows.map((r) => r.map((c) => { const v = String(c ?? ""); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v }).join(",")).join("\r\n")
    saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `attendance-${q.from}-to-${q.to}.csv`)
  }
  const myOpen = mine.entries.filter((e) => e.kind === "work" && !e.out).at(-1)
  return (
    <div className="grid gap-5">
      <PageHead icon={Clock} tone="blue" title="Attendance" sub={`Shift ${cfg.start}–${cfg.end} · late after ${cfg.grace} min grace · ${WEEKDAYS.filter(([d]) => cfg.workdays.includes(d)).map(([, l]) => l).join(", ")}`} />
      <Card><CardContent className="flex flex-wrap items-center gap-4 p-5">
        <div className="grid flex-1 gap-1"><span className="text-sm text-muted-foreground">My attendance · {nice(mine.today)}</span>
          <div className="flex flex-wrap items-center gap-2"><b className="text-lg">{mine.status.clockedIn ? `On duty since ${myOpen?.in}` : mine.status.minutes ? `${hours(mine.status.minutes)} worked today` : "Not clocked in yet"}</b><StatusBadge st={mine.status} /></div>
          {mine.entries.filter((e) => e.kind === "work").length > 0 && <span className="text-xs text-muted-foreground">{mine.entries.filter((e) => e.kind === "work").map((e) => `${e.in}–${e.out ?? "now"}`).join(" · ")}</span>}</div>
        <Button size="lg" variant={mine.status.clockedIn ? "outline" : "herb"} onClick={async () => { await (mine.status.clockedIn ? st.clockOut(me) : st.clockIn(me)); load() }}>{mine.status.clockedIn ? <><LogOut />Clock out</> : <><LogIn />Clock in</>}</Button>
      </CardContent></Card>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-full border bg-white p-1">{[["day", "Daily register"], ["sum", admin ? "Summary" : "My history"], ...(admin ? [["set", "Settings"]] : [])].map(([k, l]) => <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={cn("cursor-pointer rounded-full px-4 py-1.5 text-sm font-semibold", tab === k ? "bg-primary text-white" : "text-muted-foreground")}>{l}</button>)}</div>
        {tab === "day" && <><Button size="sm" variant="ghost" onClick={() => setDay(shift(day, -1))}>‹</Button><Input type="date" className="w-44" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /><Button size="sm" variant="ghost" onClick={() => setDay(shift(day, 1))}>›</Button>{day !== todayIso() && <Button size="sm" variant="outline" onClick={() => setDay(todayIso())}>Today</Button>}</>}
        {tab === "sum" && <>{presets.map(([l, a, b]) => <Button key={l} size="sm" variant={range.from === a && range.to === b ? "default" : "outline"} onClick={() => setRange({ from: a, to: b })}>{l}</Button>)}
          <Input type="date" className="w-40" value={range.from} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /><span className="text-sm text-muted-foreground">to</span><Input type="date" className="w-40" value={range.to} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></>}
        <span className="ml-auto flex gap-2">{admin && tab !== "set" && <><Button size="sm" variant="outline" onClick={() => setDlg({ mode: "work" })}><Plus />Add work time</Button><Button size="sm" variant="outline" onClick={() => setDlg({ mode: "leave" })}><CalendarDays />Record leave</Button></>}
          {tab !== "set" && <Button size="sm" variant="ghost" onClick={exportCsv}><Download />Export CSV</Button>}</span>
      </div>

      {tab === "day" && <Card><CardHeader><CardTitle><Users className="size-4" />{nice(day)}{admin ? "" : " · me"}</CardTitle></CardHeader><CardContent className="p-0"><Table>
        <THead><tr><TH>Staff</TH><TH>Status</TH><TH>Clock in / out</TH><TH className="text-right">Hours</TH><TH /></tr></THead>
        <tbody>{staff.map((u) => { const es = by(u.id, day), s = dayStatus(es, day, reg.today, reg.now, cfg, u.since); return (
          <TR key={u.id}><TD><b>{u.name}</b><div className="text-xs text-muted-foreground">{roleLabel(u.role)}</div></TD><TD><StatusBadge st={s} />{s.missingOut && <Badge variant="danger" className="ml-1">No clock-out</Badge>}</TD>
            <TD><div className="grid gap-1">{es.length === 0 ? <span className="text-sm text-muted-foreground">—</span> : es.map((e) => <div key={e.id} className="flex items-center gap-1.5 text-sm">
              <span>{e.kind === "leave" ? LEAVE_TYPES[e.leaveType] : `${e.in} – ${e.out ?? (day === reg.today ? "on duty" : "?")}`}</span>{e.source === "manual" && <Badge variant="muted">manual</Badge>}{e.note && <span className="text-xs text-muted-foreground">· {e.note}</span>}
              {admin && <><Button size="icon" variant="ghost" className="size-7" aria-label="Correct entry" onClick={() => setDlg({ entry: e })}><Pencil className="size-3.5" /></Button><Button size="icon" variant="ghost" className="size-7 text-destructive" aria-label="Delete entry" onClick={() => setDel(e)}><Trash2 className="size-3.5" /></Button></>}</div>)}</div></TD>
            <TD className="text-right">{s.minutes ? hours(s.minutes) : "—"}</TD><TD /></TR>) })}</tbody></Table></CardContent></Card>}

      {tab === "sum" && <Card><CardHeader><CardTitle>{nice(range.from)} – {nice(range.to)}</CardTitle></CardHeader><CardContent className="p-0"><Table>
        <THead><tr><TH>Staff</TH><TH className="text-right">Days present</TH><TH className="text-right">Late</TH><TH className="text-right">Absent</TH><TH>Leave</TH><TH className="text-right">Hours</TH><TH className="text-right">No clock-out</TH></tr></THead>
        <tbody>{staff.map((u) => { const s = reg.summary[u.id]; return <TR key={u.id}><TD><b>{u.name}</b><div className="text-xs text-muted-foreground">{roleLabel(u.role)}{u.active ? "" : " · deactivated"}</div></TD><TD className="text-right">{s.present}</TD>
          <TD className="text-right">{s.late ? <Badge variant="warn">{s.late}</Badge> : 0}</TD><TD className="text-right">{s.absent ? <Badge variant="danger">{s.absent}</Badge> : 0}</TD>
          <TD className="text-sm">{Object.entries(s.leave).map(([k, n]) => `${LEAVE_TYPES[k]} ${n}`).join(", ") || "—"}</TD><TD className="text-right">{hours(s.minutes)}</TD><TD className="text-right">{s.missingOut || 0}</TD></TR> })}</tbody></Table>
        {!admin && <div className="border-t p-4"><Table><THead><tr><TH>Day</TH><TH>Status</TH><TH>Clock in / out</TH><TH className="text-right">Hours</TH></tr></THead><tbody>
          {[...new Set(reg.entries.map((e) => e.date))].sort().reverse().map((d) => { const es = by(me.id ?? staff[0]?.id, d).length ? by(me.id ?? staff[0]?.id, d) : reg.entries.filter((e) => e.date === d), s = dayStatus(es, d, reg.today, reg.now, cfg, staff[0]?.since); return <TR key={d}><TD>{nice(d)}</TD><TD><StatusBadge st={s} /></TD><TD className="text-sm">{es.map((e) => (e.kind === "leave" ? LEAVE_TYPES[e.leaveType] : `${e.in}–${e.out ?? "?"}`)).join(" · ")}</TD><TD className="text-right">{s.minutes ? hours(s.minutes) : "—"}</TD></TR> })}</tbody></Table></div>}
      </CardContent></Card>}

      {tab === "set" && admin && <SettingsCard cfg={cfg} onDone={load} />}
      <Dialog open={!!dlg} onOpenChange={(o) => !o && setDlg(null)}>{dlg && <EntryDialog {...dlg} staff={staff.filter((u) => u.active)} day={tab === "day" ? day : todayIso()} onClose={() => setDlg(null)} onDone={load} />}</Dialog>
      <Dialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>{del && <DeleteEntry entry={del} onClose={() => setDel(null)} onDone={load} />}</Dialog>
    </div>)
}
