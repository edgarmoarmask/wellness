// Appointments & queue, and the Consultation / treatment session screen.
import { useState } from "react"
import { CalendarClock, Plus, LogIn, Play, ArrowRight, Stethoscope, AlertTriangle, ShieldCheck, Trash2, CheckCircle2, Flower2, UserRound, UserPlus, ArrowLeft, X as XIcon } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input, Textarea, NativeSelect, Label } from "@/components/ui/input"
import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog"
import { Table, THead, TR, TH, TD } from "@/components/ui/table"
import { PageHead, Status, IconChip, ServiceOptions, WhenPicker, nextSlot } from "@/components/kit"
import { useLang } from "@/lib/i18n"
import { PackageSessionOptions } from "./Catalog"
import { useStore, isToday, ageOf, maskId, checkAppointment } from "@/lib/store"
import { PatientForm } from "./Patients"
import { rm, cn, initials } from "@/lib/utils"
import { UNITS, PRACTITIONERS, SERVICES, DIAGNOSES, DOSHAS, ROOMS } from "@data/clinic.js"
import { FORMS } from "@data/inventory.js"
import { TODAY, iso } from "@data/util.js"
import { unitType, pkgOf, packageState, therapies } from "@/lib/rules"

/** How the client pays: per visit, or an active package (with any balance still due). */
export const payLabel = (p, x, PK = []) => {
  const k = PK.find((z) => z.pid === p.id && packageState(z).left > 0)
  if (!k) return x("Pay per visit", "Bayar setiap lawatan")
  const s = packageState(k)
  return s.fully ? x("Package · paid in full", "Pakej · dibayar penuh") : `${x("Package · balance", "Pakej · baki")} RM${s.balance.toFixed(2)}`
}
const pracName = (unit, id) => PRACTITIONERS[unit].find((d) => d.id === id)?.name

export function Appointments({ go, openConsult }) {
  const { x, t, lang } = useLang(); const st = useStore(); const { S } = st
  const [unit, setUnit] = useState("opd"); const [walk, setWalk] = useState(false); const [del, setDel] = useState(null); const [clear, setClear] = useState(false); const [err, setErr] = useState("")
  const isT = unitType(unit) === "therapy", todayIso = iso(new Date())
  const q = S.Q.filter((v) => v.unit === unit && isToday(v.date) && v.status !== "cancelled" && !v.cleared).sort((a, b) => a.time.localeCompare(b.time))
  const upcoming = S.Q.filter((v) => v.unit === unit && v.date > todayIso && v.status === "booked").sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
  const plan = { removed: q.filter((v) => v.status === "booked" || v.status === "waiting").length, hidden: q.filter((v) => v.status === "done").length, kept: q.filter((v) => !["booked", "waiting", "done"].includes(v.status)).length }
  const svcLabel = (v) => (v.svc === "session" ? `package session${v.pkSvc ? " · " + t(therapies().find((s) => s.id === v.pkSvc)?.name) : ""}` : v.svc ? t(therapies().find((s) => s.id === v.svc)?.name) : "")
  const dayLabel = (d) => new Date(d + "T00:00").toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
  const hours = Array.from({ length: 9 }, (_, i) => 9 + i)
  const start = async (v) => { await st.startVisit(v.id); openConsult(v.id) }
  return (
    <div className="grid gap-5">
      <PageHead icon={CalendarClock} tone="violet" title={x("Appointments & queue", "Temu janji & giliran")} sub={`${x("Today", "Hari ini")}, ${TODAY.toLocaleDateString(lang === "ms" ? "ms-MY" : "en-MY", { weekday: "long", day: "numeric", month: "long" })}`}
        right={<><div className="flex rounded-full border bg-white p-1">{UNITS.map((u) => <button key={u.id} onClick={() => setUnit(u.id)} aria-pressed={unit === u.id} className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold", unit === u.id ? "ln-grad text-white" : "text-muted-foreground")}>{u.id === "opd" ? <Stethoscope className="size-3.5" /> : <Flower2 className="size-3.5" />}{t(u.short)}</button>)}</div>
          <Button onClick={() => setWalk(true)}><Plus />{isT ? x("New booking", "Tempahan baharu") : x("Register walk-in", "Daftar walk-in")}</Button></>} />
      <Card><CardHeader><CardTitle>{isT ? x("Therapists and rooms", "Ahli terapi dan bilik") : x("Vaidyas' schedule", "Jadual Vaidya")}</CardTitle></CardHeader>
        <CardContent><div className="overflow-x-auto"><div className="min-w-[720px]">
          <div className="grid grid-cols-[170px_repeat(9,1fr)] text-[11px] text-muted-foreground"><span />{hours.map((h) => <span key={h}>{h > 12 ? h - 12 : h}{h >= 12 ? "pm" : "am"}</span>)}</div>
          {PRACTITIONERS[unit].map((d) => <div key={d.id} className="mt-2 grid grid-cols-[170px_1fr] items-center"><span className="truncate pr-2 text-sm font-semibold">{d.name}</span>
            <div className="relative h-10 rounded-lg bg-muted">{q.filter((v) => v.prac === d.id).map((v) => { const [hh, mm] = v.time.split(":").map(Number), left = (((hh - 9) * 60 + mm) / 540) * 100, w = ((isT ? 60 : 30) / 540) * 100
              return <span key={v.id} title={S.P.find((p) => p.id === v.pid).name} className={cn("absolute top-1 bottom-1 truncate rounded-md px-1.5 text-[11px] leading-8 font-semibold text-white", { booked: "bg-[#8b8fb3]", waiting: "bg-warn", consult: "bg-[#2563eb]", dispense: "bg-[#0891b2]", billing: "bg-destructive", done: "bg-ok" }[v.status])} style={{ left: `${left}%`, width: `${w}%` }}>{v.time} {S.P.find((p) => p.id === v.pid).name.split(" ")[0]}</span> })}</div></div>)}
        </div></div></CardContent></Card>
      <Card><CardHeader className="flex flex-wrap items-center gap-2"><CardTitle className="mr-auto">{x("Queue", "Giliran")} <span className="text-sm font-normal text-muted-foreground">· today · {q.length} {q.length === 1 ? "entry" : "entries"}</span></CardTitle>
        <Button size="sm" variant="outline" disabled={q.length === 0} onClick={() => setClear(true)}><Trash2 />Clear queue</Button></CardHeader><CardContent className="p-0"><Table>
        <THead><tr><TH>{x("Time", "Masa")}</TH><TH>{x("Patient", "Pesakit")}</TH><TH>{x("With", "Bersama")}</TH><TH>{x("Status", "Status")}</TH><TH /></tr></THead>
        <tbody>{q.map((v) => { const p = S.P.find((z) => z.id === v.pid); return (
          <TR key={v.id}><TD><b>{v.time}</b><div className="text-xs text-muted-foreground">{v.kind === "appt" ? x("Appointment", "Temu janji") : "Walk-in"} · {v.room}</div></TD>
            <TD><b>{p.name}</b><div className="text-xs text-muted-foreground">{payLabel(p, x, S.PK)}{v.svc && v.svc !== "session" ? ` · ${t(therapies().find((s) => s.id === v.svc)?.name)}` : v.svc === "session" ? ` · ${x("package session", "sesi pakej")}` : ""}</div>
              {p.allergy && <Badge variant="danger" className="mt-1"><AlertTriangle />{x("Allergy", "Alahan")}: {p.allergy}</Badge>}</TD>
            <TD>{pracName(v.unit, v.prac)}</TD><TD><Status s={v.status} /></TD>
            <TD className="text-right">{v.status === "booked" ? <span className="inline-flex gap-1"><Button size="sm" variant="outline" onClick={() => st.checkIn(v.id)}><LogIn />Check in</Button><Button size="icon" variant="ghost" className="text-destructive" aria-label="Delete appointment" title="Delete appointment" onClick={() => { setErr(""); setDel(v) }}><Trash2 /></Button></span>
              : v.status === "waiting" ? <Button size="sm" onClick={() => start(v)}><Play />{isT ? x("Start session", "Mula sesi") : x("Start consult", "Mula konsultasi")}</Button>
              : v.status === "consult" ? <Button size="sm" variant="outline" onClick={() => openConsult(v.id)}>{x("Open", "Buka")}<ArrowRight /></Button>
              : v.status === "dispense" ? <Button size="sm" variant="outline" onClick={() => go("pharmacy")}>{x("To pharmacy", "Ke farmasi")}<ArrowRight /></Button>
              : v.status === "billing" ? <Button size="sm" variant="outline" onClick={() => go("billing")}>{x("Take payment", "Terima bayaran")}<ArrowRight /></Button> : null}</TD></TR>) })}{q.length === 0 && <TR><TD colSpan={5} className="p-8 text-center text-sm text-muted-foreground">No one in the queue yet. Use “{isT ? "New booking" : "Register walk-in"}” to add a patient.</TD></TR>}</tbody></Table></CardContent></Card>
      <Card><CardHeader><CardTitle>Upcoming appointments <span className="text-sm font-normal text-muted-foreground">· after today · {upcoming.length}</span></CardTitle></CardHeader><CardContent className="p-0"><Table>
        <THead><tr><TH>Day</TH><TH>Time</TH><TH>Patient</TH><TH>With</TH><TH /></tr></THead>
        <tbody>{upcoming.length === 0 ? <TR><TD colSpan={5} className="p-6 text-center text-sm text-muted-foreground">No appointments booked after today.</TD></TR> : upcoming.map((v) => { const p = S.P.find((z) => z.id === v.pid); return (
          <TR key={v.id}><TD><b>{dayLabel(v.date)}</b></TD><TD>{v.time}</TD><TD><b>{p?.name}</b><div className="text-xs text-muted-foreground">{p?.phone}{svcLabel(v) ? ` · ${svcLabel(v)}` : ""}</div></TD><TD>{pracName(v.unit, v.prac)}</TD>
            <TD className="text-right"><Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setErr(""); setDel(v) }}><Trash2 />Delete</Button></TD></TR>) })}</tbody></Table></CardContent></Card>
      <WalkIn open={walk} close={() => setWalk(false)} unit={unit} />
      <Dialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>{del && <DialogContent title="Delete this appointment?" description={`${S.P.find((p) => p.id === del.pid)?.name} · ${dayLabel(del.date)} at ${del.time} · ${pracName(del.unit, del.prac)}`}>
        <p className="text-sm text-muted-foreground">The slot becomes free. The deletion is kept in the audit log.</p>{err && <p className="text-sm font-semibold text-destructive" role="alert">{err}</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDel(null)}>Keep it</Button><Button variant="destructive" onClick={async () => { const e = await st.deleteVisit(del.id); if (e) return setErr(e); setDel(null) }}><Trash2 />Delete appointment</Button></div></DialogContent>}</Dialog>
      <Dialog open={clear} onOpenChange={setClear}>{clear && <DialogContent title={`Clear today's ${isT ? "therapy" : "consultation"} queue?`} description="Use at the end of the day, or to start the queue fresh.">
        <ul className="grid gap-1.5 text-sm"><li className="flex justify-between rounded-lg bg-muted/50 px-3 py-2"><span>Not started yet (booked, waiting) · <b>removed</b></span><b>{plan.removed}</b></li>
          <li className="flex justify-between rounded-lg bg-muted/50 px-3 py-2"><span>Finished · <b>hidden</b>, still in patient records and billing</span><b>{plan.hidden}</b></li>
          <li className="flex justify-between rounded-lg bg-muted/50 px-3 py-2"><span>In consultation, pharmacy or billing · <b>stay</b> until finished</span><b>{plan.kept}</b></li></ul>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setClear(false)}>Cancel</Button><Button variant="destructive" onClick={async () => { await st.clearQueue(unit); setClear(false) }}><Trash2 />Clear queue</Button></div></DialogContent>}</Dialog>
    </div>)
}

function WalkIn({ open, close, unit }) {
  const { S, addVisit } = useStore(); const isT = unitType(unit) === "therapy"
  const [pid, setPid] = useState(""); const [q, setQ] = useState(""); const [prac, setPrac] = useState(""); const [svc, setSvc] = useState("abhy"); const [kind, setKind] = useState("walkin"); const [time, setTime] = useState(nextSlot); const [date, setDate] = useState(() => iso(new Date())); const [reg, setReg] = useState(false)
  const apptErr = kind === "appt" ? checkAppointment(date, time) : null
  const reset = () => { setPid(""); setQ(""); setKind("walkin"); setDate(iso(new Date())); setTime(nextSlot()) }
  const pr = PRACTITIONERS[unit].some((d) => d.id === prac) ? prac : PRACTITIONERS[unit][0].id
  const term = q.trim().toLowerCase(), matches = term ? S.P.filter((p) => [p.name, p.idNo, p.phone, p.id].some((v) => (v || "").toLowerCase().includes(term))).slice(0, 6) : S.P.slice(0, 6)
  const sel = S.P.find((p) => p.id === pid), hasPk = sel && S.PK.some((k) => k.pid === pid && packageState(k).left > 0)
  return (<>
    <Dialog open={open && !reg} onOpenChange={(o) => { if (!o) { close(); reset() } }}><DialogContent title={isT ? "New therapy booking" : "Register walk-in / appointment"} description={UNITS.find((u) => u.id === unit).name.en}>
      {sel ? <div className="flex items-center gap-3 rounded-xl border bg-accent/40 p-3"><span className="grid size-9 place-items-center rounded-full ln-grad text-xs font-bold text-white">{initials(sel.name)}</span><div className="flex-1 text-sm"><b>{sel.name}</b><div className="text-xs text-muted-foreground">{sel.id} · {maskId(sel.idNo)} · {sel.phone}</div></div><Button size="sm" variant="ghost" onClick={() => setPid("")}>Change</Button></div>
        : <div className="grid gap-2"><Label>Find patient<Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, MyKad, phone or patient no." autoFocus /></Label>
          <div className="grid gap-1">{matches.map((p) => <button key={p.id} type="button" onClick={() => setPid(p.id)} className="flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-left text-sm hover:border-primary"><span><b>{p.name}</b> <span className="text-xs text-muted-foreground">{p.id}</span></span><span className="text-xs text-muted-foreground">{p.phone}</span></button>)}
            {S.P.length === 0 && <p className="text-sm text-muted-foreground">No patients registered yet.</p>}{S.P.length > 0 && matches.length === 0 && <p className="text-sm text-muted-foreground">No match.</p>}</div>
          <Button variant="herb" onClick={() => setReg(true)}><UserPlus />Register new patient</Button></div>}
      {sel && <>
        <Label>With<NativeSelect value={pr} onChange={(e) => setPrac(e.target.value)}>{PRACTITIONERS[unit].map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect></Label>
        {isT && <Label>Therapy<NativeSelect value={svc} onChange={(e) => setSvc(e.target.value)}><PackageSessionOptions pid={pid} /><ServiceOptions list={therapies()} rm={rm} /></NativeSelect></Label>}
        <WhenPicker kind={kind} setKind={setKind} date={date} setDate={setDate} time={time} setTime={setTime} error={apptErr} />
        <Button disabled={!!apptErr} onClick={async () => { if (await addVisit(pid, unit, pr, isT ? svc : undefined, kind, kind === "appt" ? time : undefined, kind === "appt" ? date : undefined)) { close(); reset() } }}><Plus />{kind === "walkin" ? "Add to queue" : "Book appointment"}</Button></>}
    </DialogContent></Dialog>
    <PatientForm open={reg} close={() => setReg(false)} onSaved={(id) => setPid(id)} /></>)
}

export function Consult({ id, go, openConsult, openPatient, back }) {
  const { x, t, day } = useLang(); const st = useStore(); const { S } = st
  const [itemId, setItemId] = useState(""); const [qty, setQty] = useState("0"); const [msg, setMsg] = useState(null)
  const v = id && S.Q.find((q) => q.id === id)
  const active = S.Q.filter((q) => q.status === "consult")
  if (!v || v.status !== "consult") return (
    <div className="grid gap-5"><PageHead icon={Stethoscope} tone="herb" title={x("Consultation", "Konsultasi")} sub={x("Start a consultation or therapy session from the queue.", "Mulakan konsultasi atau sesi terapi daripada giliran.")} />
      <Card><CardHeader><CardTitle>Current consultations and sessions <span className="text-sm font-normal text-muted-foreground">· {active.length}</span></CardTitle></CardHeader><CardContent className="grid gap-2">
        {active.length ? active.map((a) => { const pa = S.P.find((p) => p.id === a.pid), notes = S.rx[a.id]; return <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm"><span className="grid gap-0.5"><span><b>{pa.name}</b> · {t(UNITS.find((u) => u.id === a.unit).short)} · {pracName(a.unit, a.prac)}</span>
          <span className="text-xs text-muted-foreground">{a.time} · {a.room}{pa.allergy ? ` · allergy: ${pa.allergy}` : ""}{notes?.items?.length ? ` · ${notes.items.length} medicine${notes.items.length > 1 ? "s" : ""} added` : ""}{notes?.dx ? ` · ${notes.dx}` : ""}</span></span><Button size="sm" onClick={() => openConsult(a.id)}>{x("Open", "Buka")}<ArrowRight /></Button></div> })
          : <div className="grid justify-items-center gap-3 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground"><IconChip icon={UserRound} tone="violet" size="lg" />{x("No one in consultation right now.", "Tiada sesiapa dalam konsultasi sekarang.")}<Button variant="outline" onClick={() => go("appointments")}>{x("Go to the queue", "Pergi ke giliran")}<ArrowRight /></Button></div>}</CardContent></Card></div>)
  const p = S.P.find((z) => z.id === v.pid), isT = unitType(v.unit) === "therapy"
  const rx = S.rx[v.id] || { items: [], dx: "", dosha: "", note: "", mc: 0, svc: isT ? "abhy" : "cons" }
  const live = S.INV.filter((i) => !i.archived), inv = isT ? live : live.filter((i) => i.use !== "therapy")
  const hist = S.INVC.filter((i) => i.pid === p.id).slice(-5).reverse()
  const pk = S.PK.filter((k) => k.pid === p.id && packageState(k).left > 0)
  const q = Number(qty)
  const add = async () => {
    if (!itemId) return setMsg(["block", "Choose a medicine or oil first."])
    if (!(Number.isInteger(q) && q >= 1)) return setMsg(["block", "Enter a quantity of 1 or more."])
    const r = await st.addRx(v.id, itemId, q); setMsg(r.block ? ["block", r.block] : r.warn ? ["warn", r.warn] : null)
    if (!r.block) { setItemId(""); setQty("0") }
  }
  const done = async () => { const err = await st.complete(v.id); if (err) setMsg(["block", err]); else go((rx.items.length ? "pharmacy" : "billing")) }
  return (
    <div className="grid gap-5">
      <PageHead icon={isT ? Flower2 : Stethoscope} tone="herb" title={isT ? x("Therapy session", "Sesi terapi") : x("Consultation", "Konsultasi")} sub={`${t(UNITS.find((u) => u.id === v.unit).name)} · ${pracName(v.unit, v.prac)} · ${v.room}`}
        right={<Button variant="outline" onClick={back}><ArrowLeft />All current consultations{active.length > 1 ? ` (${active.length})` : ""}</Button>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_1.5fr]">
        <Card><CardHeader><CardTitle>{x("Patient", "Pesakit")}</CardTitle></CardHeader><CardContent className="grid gap-3">
          <div className="flex items-center gap-3"><span className="grid size-12 place-items-center rounded-full ln-grad font-bold text-white">{initials(p.name)}</span><div><b>{p.name}</b><div className="text-xs text-muted-foreground">{p.id}{p.sex ? ` · ${p.sex === "F" ? "Female" : "Male"}` : ""}{ageOf(p.dob) != null ? `, ${ageOf(p.dob)}` : ""} · {maskId(p.idNo)}</div><div className="text-xs text-muted-foreground">{payLabel(p, x, S.PK)}</div></div></div>
          {p.allergy && <div className="flex items-center gap-2 rounded-xl bg-[#fee2e2] p-3 text-sm font-semibold text-destructive"><AlertTriangle className="size-4" />{x("Allergy", "Alahan")}: {p.allergy}</div>}
          {(p.flags || []).length > 0 && <div className="flex flex-wrap gap-1">{p.flags.map((f) => <Badge key={f} variant="warn">{{ diabetes: x("Diabetes", "Diabetes"), hypertension: x("Hypertension", "Hipertensi"), pregnant: x("Pregnant", "Hamil") }[f]}</Badge>)}</div>}
          {pk.length > 0 && <div className="rounded-xl bg-herb-soft p-3 text-sm"><b className="text-herb">{x("Active package", "Pakej aktif")}</b>{pk.map((k) => <div key={k.id}>{t(packageState(k).g.name)} · {x("session", "sesi")} {k.used + 1} / {pkgOf(k.pkg).sessions}</div>)}</div>}
          <Button size="sm" variant="outline" className="w-fit" onClick={() => openPatient(p.id)}><UserRound />Open full patient record</Button>
          <div className="text-sm font-bold">{x("Previous visits", "Lawatan terdahulu")}</div>
          {hist.length ? hist.map((i) => <div key={i.id} className="flex justify-between text-sm"><span>{day(i.date)} · {i.lines[0].d}</span><span>{rm(i.total)}</span></div>) : <p className="text-sm text-muted-foreground">{x("First visit.", "Lawatan pertama.")}</p>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>{isT ? x("Assessment and therapy", "Penilaian dan terapi") : x("Consultation notes", "Nota konsultasi")}</CardTitle></CardHeader><CardContent className="grid gap-3">
          <Label>{x("Service", "Perkhidmatan")}<NativeSelect value={rx.svc} onChange={(e) => st.setRx(v.id, { svc: e.target.value })}><ServiceOptions list={isT ? therapies() : SERVICES.consult} rm={rm} />{isT && pk.length > 0 && <option value="session">{x("Package session (prepaid)", "Sesi pakej (prabayar)")}</option>}</NativeSelect></Label>
          {!isT && <div className="grid gap-3 sm:grid-cols-2"><Label>{x("Diagnosis (ICD-10)", "Diagnosis (ICD-10)")}<NativeSelect value={rx.dx} onChange={(e) => st.setRx(v.id, { dx: e.target.value, dosha: rx.dosha || DIAGNOSES.find((d) => d[0] === e.target.value)?.[2] || "" })}><option value="">{x("Choose…", "Pilih…")}</option>{DIAGNOSES.map(([c, n]) => <option key={c} value={c}>{c} · {t(n)}</option>)}</NativeSelect></Label>
            <Label>{x("Dosha assessment", "Penilaian dosha")}<NativeSelect value={rx.dosha} onChange={(e) => st.setRx(v.id, { dosha: e.target.value })}><option value="">{x("Choose…", "Pilih…")}</option>{DOSHAS.map(([k, n]) => <option key={k} value={k}>{t(n)}</option>)}</NativeSelect></Label></div>}
          <Label>{isT ? x("Assessment (complaint, goals)", "Penilaian (aduan, matlamat)") : x("Clinical notes (Nadi pariksha, findings, plan)", "Nota klinikal (Nadi pariksha, penemuan, pelan)")}<Textarea rows={3} value={rx.note} onChange={(e) => st.setRx(v.id, { note: e.target.value })} placeholder={isT ? x("e.g. stiff lower back, poor sleep", "cth. belakang bawah tegang, tidur kurang lena") : x("Pulse, tongue, digestion, sleep; plan", "Nadi, lidah, penghadaman, tidur; pelan")} /></Label>
          {!isT && <Label className="w-48">{x("Medical certificate (days)", "Sijil cuti sakit (hari)")}<Input type="number" min={0} max={7} value={rx.mc} onChange={(e) => st.setRx(v.id, { mc: +e.target.value })} /></Label>}
          <div className="grid items-end gap-2 sm:grid-cols-[1fr_90px_auto]"><Label>Medicines and oils (optional)<NativeSelect value={itemId} onChange={(e) => { setItemId(e.target.value); setMsg(null) }}><option value="">Choose…</option>{inv.map((i) => <option key={i.id} value={i.id}>{i.name} · {t(FORMS[i.form])} ({i.stock} {x("in stock", "dalam stok")})</option>)}</NativeSelect></Label>
            <Label>{x("Qty", "Kuantiti")}<Input type="number" min={0} value={qty} onChange={(e) => { setQty(e.target.value); setMsg(null) }} /></Label><Button variant="outline" disabled={!itemId || !(q >= 1)} onClick={add}><Plus />{x("Add", "Tambah")}</Button></div>
          {rx.items.length === 0 && <p className="-mt-1 text-xs text-muted-foreground">No medicines needed? Leave this and complete the visit — it goes straight to billing.</p>}
          {msg && <div className={cn("flex items-start gap-2 rounded-xl p-3 text-sm font-semibold", msg[0] === "block" ? "bg-[#fee2e2] text-destructive" : "bg-[#fdf1dc] text-warn")} role="alert"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{t(msg[1])}</div>}
          {rx.items.length > 0 && <div className="grid gap-1 rounded-xl border p-2">{rx.items.map((it, i) => { const m = S.INV.find((z) => z.id === it.id); return <div key={i} className="flex items-center gap-2 text-sm"><span className="flex-1">{m.name}</span><span>× {it.q}</span><b className="w-20 text-right">{rm(m.price * it.q)}</b><button onClick={() => st.delRx(v.id, i)} aria-label={x("Remove", "Buang")} className="grid size-8 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-[#fee2e2] hover:text-destructive"><Trash2 className="size-4" /></button></div> })}</div>}
          <Button variant="herb" size="lg" onClick={done}><CheckCircle2 />{x("Complete and send to", "Selesai dan hantar ke")} {rx.items.length ? x("pharmacy", "farmasi") : x("billing", "bil")}</Button>
        </CardContent></Card>
      </div>
    </div>)
}
