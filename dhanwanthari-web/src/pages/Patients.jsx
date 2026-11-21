// Patients: register, search, edit, and the full patient record (visits, notes, medicines, packages, payments, invoices).
import { useState } from "react"
import { Users, UserPlus, Search, Pencil, Printer, AlertTriangle, CalendarPlus, Phone, Mail, MapPin, IdCard, HeartPulse, Gift, Receipt, Stethoscope, Flower2, ShieldCheck, ArrowLeft, Pill, FileText } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input, Textarea, NativeSelect, Label } from "@/components/ui/input"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Table, THead, TR, TH, TD } from "@/components/ui/table"
import { Progress } from "@/components/ui/progress"
import { PageHead, IconChip, Status, ServiceOptions, WhenPicker, nextSlot } from "@/components/kit"
import { iso } from "@data/util.js"
import { BillDialog, invoiceBill } from "./BillPrint"
import { useLang } from "@/lib/i18n"
import { PackageSessionOptions } from "./Catalog"
import { useStore, ageOf, maskId, bmi, bmiLabel, checkAppointment } from "@/lib/store"
import { rm, cn, initials } from "@/lib/utils"
import { CONDITION_FLAGS } from "@data/patients.js"
import { UNITS, PRACTITIONERS, SERVICES, DIAGNOSES, DOSHAS } from "@data/clinic.js"
import { pkgOf, packageState, unitType, therapies, svcOf } from "@/lib/rules"
import { isCitizen } from "@/lib/ledger"

const EMPTY = { name: "", citizenship: "citizen", idType: "mykad", idNo: "", dob: "", sex: "", phone: "", email: "", address: "", allergy: "", flags: [], emergencyName: "", emergencyPhone: "", notes: "", pdpaConsent: false, heightCm: "", weightKg: "", bp: "" }
const pracName = (unit, id) => PRACTITIONERS[unit]?.find((d) => d.id === id)?.name ?? ""
const svcName = (unit, id) => (id === "session" ? "Package session (prepaid)" : svcOf(unit, id)?.name.en ?? "")

/** MyKad 900101-14-5678 → date of birth and sex (last digit odd = male). */
function fromMyKad(no) {
  const d = no.replace(/\D/g, "")
  if (d.length !== 12) return {}
  const yy = +d.slice(0, 2), mm = d.slice(2, 4), dd = d.slice(4, 6), yr = yy > (new Date().getFullYear() % 100) ? 1900 + yy : 2000 + yy
  const dob = `${yr}-${mm}-${dd}`
  return isNaN(new Date(dob)) ? {} : { dob, sex: +d[11] % 2 ? "M" : "F" }
}

/** Registration / edit form. onSaved(id) after a successful save. */
export function PatientForm({ open, close, editId, onSaved }) {
  const st = useStore(); const cur = editId && st.S.P.find((p) => p.id === editId)
  const [f, setF] = useState(cur ? { ...EMPTY, ...cur } : EMPTY); const [err, setErr] = useState("")
  const [key, setKey] = useState(open + (editId || ""))
  if (key !== open + (editId || "")) { setKey(open + (editId || "")); setF(cur ? { ...EMPTY, ...cur } : EMPTY); setErr("") }
  const set = (patch) => setF((o) => ({ ...o, ...patch }))
  const save = async () => { const r = await st.savePatient(f, editId); if (r.error) setErr(r.error); else { close(); onSaved?.(r.id) } }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}><DialogContent title={editId ? "Edit patient record" : "Register a new patient"} description="Fields marked * are required." className="max-w-2xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <Label className="sm:col-span-2">Full name (as in MyKad / passport) *<Input value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></Label>
        <Label>ID type<NativeSelect value={f.idType} onChange={(e) => set({ idType: e.target.value, citizenship: e.target.value === "mykad" ? "citizen" : "non-citizen" })}><option value="mykad">MyKad</option><option value="passport">Passport</option></NativeSelect></Label>
        <Label>{f.idType === "mykad" ? "MyKad number *" : "Passport number *"}<Input value={f.idNo} placeholder={f.idType === "mykad" ? "900101-14-5678" : ""} onChange={(e) => { const idNo = e.target.value; set({ idNo, ...(f.idType === "mykad" && !f.dob ? fromMyKad(idNo) : {}) }) }} /></Label>
        <Label className="sm:col-span-2">Citizenship (decides SST) *<NativeSelect value={f.citizenship} onChange={(e) => set({ citizenship: e.target.value })}><option value="citizen">Malaysian citizen (SST exempt)</option><option value="non-citizen">Non-Malaysian (6% SST applies when the centre is SST-registered)</option></NativeSelect></Label>
        <Label>Date of birth<Input type="date" value={f.dob} onChange={(e) => set({ dob: e.target.value })} /></Label>
        <Label>Sex<NativeSelect value={f.sex} onChange={(e) => set({ sex: e.target.value })}><option value="">Choose…</option><option value="F">Female</option><option value="M">Male</option></NativeSelect></Label>
        <div className="grid gap-3 rounded-xl border bg-muted/30 p-3 sm:col-span-2 sm:grid-cols-3"><span className="text-sm font-semibold sm:col-span-3">Vitals <span className="font-normal text-muted-foreground">(optional, at registration)</span></span>
          <Label>Height (cm)<Input inputMode="decimal" value={f.heightCm ?? ""} placeholder="e.g. 162" onChange={(e) => set({ heightCm: e.target.value })} /></Label>
          <Label>Weight (kg)<Input inputMode="decimal" value={f.weightKg ?? ""} placeholder="e.g. 58.5" onChange={(e) => set({ weightKg: e.target.value })} /></Label>
          <Label>Blood pressure (mmHg)<Input value={f.bp ?? ""} placeholder="e.g. 120/80" onChange={(e) => set({ bp: e.target.value })} /></Label>
          {(() => { const b = bmi(Number(f.heightCm), Number(f.weightKg)); return b && b > 5 && b < 100 ? <span className="text-xs text-muted-foreground sm:col-span-3">BMI <b className="text-foreground">{b}</b> · {bmiLabel(b)}</span> : null })()}</div>
        <Label>Phone (WhatsApp) *<Input type="tel" value={f.phone} placeholder="012-345 6789" onChange={(e) => set({ phone: e.target.value })} /></Label>
        <Label>Email<Input type="email" value={f.email} placeholder="for invoices and receipts" onChange={(e) => set({ email: e.target.value })} /><span className="text-xs font-normal text-muted-foreground">Invoices and receipts are emailed here.</span></Label>
        <Label className="sm:col-span-2">Address<Input value={f.address} onChange={(e) => set({ address: e.target.value })} /></Label>
        <Label className="sm:col-span-2">Allergies (e.g. sesame oil)<Input value={f.allergy} placeholder="None known" onChange={(e) => set({ allergy: e.target.value })} /></Label>
        <div className="grid gap-1.5 sm:col-span-2"><span className="text-sm font-semibold">Conditions to check before prescribing</span><div className="flex flex-wrap gap-2">{CONDITION_FLAGS.map(([k, l]) => { const on = f.flags.includes(k); return <button key={k} type="button" aria-pressed={on} onClick={() => set({ flags: on ? f.flags.filter((z) => z !== k) : [...f.flags, k] })} className={cn("cursor-pointer rounded-full border px-3 py-1.5 text-sm font-semibold", on ? "border-warn bg-[#fdf1dc] text-warn" : "bg-white")}>{l.en}</button> })}</div></div>
        <Label>Emergency contact name<Input value={f.emergencyName} onChange={(e) => set({ emergencyName: e.target.value })} /></Label>
        <Label>Emergency contact phone<Input type="tel" value={f.emergencyPhone} onChange={(e) => set({ emergencyPhone: e.target.value })} /></Label>
        <Label className="sm:col-span-2">Notes (prakriti, preferences, referral source)<Textarea rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Label>
        <label className="flex cursor-pointer items-start gap-2 rounded-xl border bg-muted/40 p-3 text-sm sm:col-span-2"><input type="checkbox" className="mt-0.5 size-4 accent-[#1f7a3f]" checked={f.pdpaConsent} onChange={(e) => set({ pdpaConsent: e.target.checked })} /><span>The patient has read and agreed to the clinic's PDPA (personal data) notice. *</span></label>
      </div>
      {err && <p className="text-sm font-semibold text-destructive" role="alert">{err}</p>}
      <Button variant="herb" size="lg" onClick={save}><UserPlus />{editId ? "Save changes" : "Register patient"}</Button>
    </DialogContent></Dialog>)
}

export function Patients({ go, openConsult, patientId, openPatient }) {
  const { S } = useStore()
  const [q, setQ] = useState(""); const [form, setForm] = useState(false)
  if (patientId && S.P.some((p) => p.id === patientId)) return <PatientRecord id={patientId} back={() => openPatient(null)} go={go} />
  const term = q.trim().toLowerCase()
  const list = S.P.filter((p) => !term || [p.name, p.idNo, p.phone, p.id].some((v) => (v || "").toLowerCase().includes(term)))
  const lastVisit = (pid) => S.Q.filter((v) => v.pid === pid && v.status === "done").map((v) => v.date).sort().pop()
  return (
    <div className="grid gap-5">
      <PageHead icon={Users} tone="violet" title="Patients" sub="Register clients and open their full record." right={<Button size="lg" onClick={() => setForm(true)}><UserPlus />Register patient</Button>} />
      {S.P.length === 0 ? (
        <Card><CardContent className="grid justify-items-center gap-4 p-10 text-center">
          <IconChip icon={UserPlus} tone="herb" size="lg" />
          <div><h2 className="text-xl font-bold">No patients yet</h2><p className="mt-1 max-w-md text-sm text-muted-foreground">Register your first patient with their MyKad or passport details. Their visits, prescriptions, packages and payments will appear in their record.</p></div>
          <Button size="lg" variant="herb" onClick={() => setForm(true)}><UserPlus />Register the first patient</Button>
        </CardContent></Card>
      ) : (
        <Card><CardHeader><div className="relative w-full max-w-md"><Search className="absolute top-3 left-3 size-4 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, MyKad, phone or patient no." className="pl-9" aria-label="Search patients" /></div><Badge variant="muted" className="ml-auto">{list.length} of {S.P.length}</Badge></CardHeader>
          <CardContent className="p-0"><Table>
            <THead><tr><TH>Patient</TH><TH>ID</TH><TH>Phone</TH><TH>Alerts</TH><TH>Last visit</TH><TH /></tr></THead>
            <tbody>{list.map((p) => { const lv = lastVisit(p.id); return (
              <TR key={p.id} className="cursor-pointer" onClick={() => openPatient(p.id)}>
                <TD><div className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-full ln-grad text-xs font-bold text-white">{initials(p.name)}</span><div><b>{p.name}</b><div className="text-xs text-muted-foreground">{p.id}{ageOf(p.dob) != null ? ` · ${ageOf(p.dob)} y` : ""}{p.sex ? ` · ${p.sex === "F" ? "Female" : "Male"}` : ""}</div></div></div></TD>
                <TD className="font-mono text-xs">{maskId(p.idNo)}</TD><TD>{p.phone}</TD>
                <TD><div className="flex flex-wrap gap-1">{p.allergy && <Badge variant="danger"><AlertTriangle />{p.allergy}</Badge>}{(p.flags || []).map((f) => <Badge key={f} variant="warn">{CONDITION_FLAGS.find((c) => c[0] === f)[1].en}</Badge>)}</div></TD>
                <TD>{lv ? new Date(lv).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : <span className="text-muted-foreground">—</span>}</TD>
                <TD className="text-right"><Button size="sm" variant="outline">Open record</Button></TD></TR>) })}
              {list.length === 0 && <TR><TD colSpan={6} className="p-6 text-center text-muted-foreground">No patient matches “{q}”.</TD></TR>}</tbody></Table></CardContent></Card>)}
      <PatientForm open={form} close={() => setForm(false)} onSaved={(id) => openPatient(id)} />
    </div>)
}

function PatientRecord({ id, back, go }) {
  const { date } = useLang(); const st = useStore(); const { S } = st
  const [edit, setEdit] = useState(false); const [book, setBook] = useState(false)
  const p = S.P.find((z) => z.id === id)
  const visits = S.Q.filter((v) => v.pid === id).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
  const pk = S.PK.filter((k) => k.pid === id).map((k) => ({ k, ...packageState(k) }))
  const inv = S.INVC.filter((i) => i.pid === id).slice().reverse(), [bill, setBill] = useState(null)
  const spent = inv.reduce((a, i) => a + i.total, 0) + pk.reduce((a, s) => a + s.paid, 0)
  const age = ageOf(p.dob)
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2 print:hidden"><Button variant="ghost" onClick={back}><ArrowLeft />All patients</Button>
        <div className="ml-auto flex flex-wrap gap-2"><Button variant="outline" onClick={() => window.print()}><Printer />Print record</Button><Button variant="outline" onClick={() => setEdit(true)}><Pencil />Edit details</Button><Button onClick={() => setBook(true)}><CalendarPlus />Book visit</Button></div></div>
      <Card><CardContent className="grid gap-5 p-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="flex gap-4"><span className="grid size-16 shrink-0 place-items-center rounded-full ln-grad text-xl font-bold text-white">{initials(p.name)}</span>
          <div className="grid gap-1"><h1 className="text-2xl font-bold">{p.name}</h1><div className="flex flex-wrap gap-2 text-sm text-muted-foreground"><Badge variant="herb">{p.id}</Badge>{age != null && <span>{age} years</span>}{p.sex && <span>· {p.sex === "F" ? "Female" : "Male"}</span>}{p.dob && <span>· born {date(p.dob)}</span>}</div>
            <div className="mt-1 grid gap-1 text-sm"><span className="flex items-center gap-2"><IdCard className="size-4 text-muted-foreground" />{p.idType === "passport" ? "Passport" : "MyKad"} {p.idNo} · {isCitizen(p) ? "Malaysian citizen" : "Non-Malaysian"}</span><span className="flex items-center gap-2"><Phone className="size-4 text-muted-foreground" />{p.phone}</span>{p.email && <span className="flex items-center gap-2"><Mail className="size-4 text-muted-foreground" />{p.email}</span>}{p.address && <span className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" />{p.address}</span>}
              {p.emergencyName && <span className="text-xs text-muted-foreground">Emergency contact: {p.emergencyName} {p.emergencyPhone}</span>}</div></div></div>
        <div className="grid content-start gap-2">
          {p.allergy ? <div className="flex items-center gap-2 rounded-xl bg-[#fee2e2] p-3 text-sm font-semibold text-destructive"><AlertTriangle className="size-4" />Allergy: {p.allergy}</div> : <div className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">No known allergies recorded</div>}
          {(p.flags || []).length > 0 && <div className="flex flex-wrap gap-1">{p.flags.map((f) => <Badge key={f} variant="warn"><HeartPulse />{CONDITION_FLAGS.find((c) => c[0] === f)[1].en}</Badge>)}</div>}
          {p.notes && <p className="rounded-xl border p-3 text-sm"><FileText className="mr-1 inline size-4 text-muted-foreground" />{p.notes}</p>}
          {(p.heightCm || p.weightKg || p.bp) && (() => { const b = bmi(p.heightCm, p.weightKg); return <div className="grid grid-cols-4 gap-2 text-center text-xs">{[["Height", p.heightCm ? `${p.heightCm} cm` : "—"], ["Weight", p.weightKg ? `${p.weightKg} kg` : "—"], ["BMI", b ? `${b}` : "—"], ["BP", p.bp ? `${p.bp}` : "—"]].map(([l, v]) => <div key={l} className="rounded-xl border p-2"><b className="block text-sm">{v}</b><span className="text-muted-foreground">{l}{l === "BMI" && b ? ` · ${bmiLabel(b)}` : ""}</span></div>)}</div> })()}
          <div className="grid grid-cols-3 gap-2 text-center">{[["Visits", visits.filter((v) => v.status === "done").length], ["Packages", pk.length], ["Total paid", rm(spent)]].map(([l, v]) => <div key={l} className="rounded-xl bg-muted p-2"><b className="font-display">{v}</b><div className="text-[11px] text-muted-foreground">{l}</div></div>)}</div>
          <span className="flex items-center gap-1 text-xs text-ok"><ShieldCheck className="size-3.5" />PDPA consent recorded{p.created ? ` · registered ${date(p.created)}` : ""}</span>
        </div></CardContent></Card>

      <Card><CardHeader><CardTitle><Stethoscope className="size-4 text-herb" />Visit history and clinical notes</CardTitle></CardHeader><CardContent className="grid gap-3">
        {visits.length === 0 ? <p className="text-sm text-muted-foreground">No visits yet. Use “Book visit” to add one.</p> : visits.map((v) => { const rx = S.rx[v.id], dx = rx?.dx && DIAGNOSES.find((d) => d[0] === rx.dx), dosha = rx?.dosha && DOSHAS.find((d) => d[0] === rx.dosha), isT = unitType(v.unit) === "therapy"
          return (
            <div key={v.id} className="grid gap-2 rounded-2xl border p-4">
              <div className="flex flex-wrap items-center gap-2"><IconChip icon={isT ? Flower2 : Stethoscope} tone="herb" size="sm" /><b>{date(v.date)} · {v.time}</b><span className="text-sm text-muted-foreground">{UNITS.find((u) => u.id === v.unit).short.en} · {pracName(v.unit, v.prac)}</span><span className="ml-auto"><Status s={v.status} /></span></div>
              {rx && <div className="grid gap-1 text-sm">
                <div><span className="text-muted-foreground">Service:</span> {svcName(v.unit, rx.svc)}</div>
                {dx && <div><span className="text-muted-foreground">Diagnosis:</span> {dx[0]} · {dx[1].en}{dosha ? ` · ${dosha[1].en}` : ""}</div>}
                {rx.note && <div><span className="text-muted-foreground">Notes:</span> {rx.note}</div>}
                {rx.mc > 0 && <div><span className="text-muted-foreground">Medical certificate:</span> {rx.mc} day(s)</div>}
                {rx.items.length > 0 && <div className="flex flex-wrap items-center gap-1"><Pill className="size-4 text-muted-foreground" />{rx.items.map((it, i) => <Badge key={i} variant={it.warn ? "warn" : "muted"}>{S.INV.find((z) => z.id === it.id)?.name} × {it.q}</Badge>)}</div>}
              </div>}
              {v.invoice && <div className="text-xs text-muted-foreground">Receipt {v.invoice}</div>}
            </div>) })}</CardContent></Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle><Gift className="size-4 text-pink" />Packages and payments</CardTitle><Button size="sm" variant="outline" className="ml-auto" onClick={() => go("packages")}>Sell package</Button></CardHeader><CardContent className="grid gap-3">
          {pk.length === 0 ? <p className="text-sm text-muted-foreground">No packages.</p> : pk.map(({ k, g, paid, balance, fully, unlocked }) => (
            <div key={k.id} className="grid gap-2 rounded-xl border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><b>{g.name.en}</b>{fully ? <Badge variant="ok">Paid in full</Badge> : <Badge variant="warn">Balance {rm(balance)}</Badge>}</div>
              <Progress value={(k.used / g.sessions) * 100} color="var(--herb)" /><span className="text-xs text-muted-foreground">{k.used} of {g.sessions} sessions used{!fully ? ` · ${unlocked} paid for` : ""} · bought {date(k.sold)} · {k.plan === "full" ? "full payment" : "partial payment"}</span>
              <div className="grid gap-0.5 text-xs">{k.payments.map((q, i) => <div key={i} className="flex justify-between"><span>{date(q.date)} · {{ card: "Card", duitnow: "DuitNow QR", cash: "Cash" }[q.method]}</span><b>{rm(q.amt)}</b></div>)}<div className="flex justify-between border-t pt-0.5"><span>Paid</span><b>{rm(paid)}</b></div></div>
            </div>))}</CardContent></Card>
        <Card><CardHeader><CardTitle><Receipt className="size-4 text-amber" />Invoices</CardTitle></CardHeader><CardContent className="p-0">
          {inv.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No invoices.</p> : <Table><THead><tr><TH>Invoice</TH><TH>Items</TH><TH className="text-right">Total</TH><TH /></tr></THead>
            <tbody>{inv.map((i) => <TR key={i.id}><TD><b>{i.id}</b><div className="text-xs text-muted-foreground">{date(i.date)} · {{ cash: "Cash", card: "Card", duitnow: "DuitNow QR", package: "Package" }[i.method]}</div></TD><TD className="text-xs">{i.lines.map((l) => `${l.d} × ${l.q}`).join(", ")}</TD><TD className="text-right">{rm(i.total)}</TD><TD className="text-right"><Button size="sm" variant="ghost" aria-label={`Print bill ${i.id}`} onClick={() => setBill(invoiceBill(i, S))}><Printer /></Button></TD></TR>)}</tbody></Table>}</CardContent></Card>
        <Dialog open={!!bill} onOpenChange={(o) => !o && setBill(null)}>{bill && <BillDialog bill={bill} onClose={() => setBill(null)} />}</Dialog>
      </div>
      <PatientForm open={edit} close={() => setEdit(false)} editId={id} />
      <BookVisit open={book} close={() => setBook(false)} pid={id} done={() => go("appointments")} />
    </div>)
}

/** Book a visit for a known patient: walk-in now, or an appointment on a chosen day and time. */
export function BookVisit({ open, close, pid, done, unit: unit0 = "opd" }) {
  const { S, addVisit } = useStore()
  const [unit, setUnit] = useState(unit0); const [prac, setPrac] = useState(""); const [svc, setSvc] = useState("abhy"); const [kind, setKind] = useState("walkin"); const [time, setTime] = useState(nextSlot); const [date, setDate] = useState(() => iso(new Date()))
  const apptErr = kind === "appt" ? checkAppointment(date, time) : null
  const isT = unit === "tx", pr = PRACTITIONERS[unit].some((d) => d.id === prac) ? prac : PRACTITIONERS[unit][0].id
  const hasPk = S.PK.some((k) => k.pid === pid && packageState(k).left > 0)
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { close(); setKind("walkin"); setDate(iso(new Date())); setTime(nextSlot()) } }}><DialogContent title="Book a visit" description={S.P.find((p) => p.id === pid)?.name}>
      <div className="grid grid-cols-2 gap-2">{UNITS.map((u) => <button key={u.id} type="button" onClick={() => setUnit(u.id)} aria-pressed={unit === u.id} className={cn("flex cursor-pointer items-center justify-center gap-2 rounded-xl border p-3 text-sm font-semibold", unit === u.id ? "border-primary bg-accent text-primary" : "")}>{u.id === "opd" ? <Stethoscope className="size-4" /> : <Flower2 className="size-4" />}{u.short.en}</button>)}</div>
      <Label>With<NativeSelect value={pr} onChange={(e) => setPrac(e.target.value)}>{PRACTITIONERS[unit].map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</NativeSelect></Label>
      {isT && <Label>Therapy<NativeSelect value={svc} onChange={(e) => setSvc(e.target.value)}><PackageSessionOptions pid={pid} /><ServiceOptions list={therapies()} rm={rm} /></NativeSelect></Label>}
      <WhenPicker kind={kind} setKind={setKind} date={date} setDate={setDate} time={time} setTime={setTime} error={apptErr} />
      <Button disabled={!!apptErr} onClick={async () => { if (await addVisit(pid, unit, pr, isT ? svc : undefined, kind, kind === "appt" ? time : undefined, kind === "appt" ? date : undefined)) { close(); setKind("walkin"); done?.() } }}><CalendarPlus />{kind === "walkin" ? "Add to queue" : "Book appointment"}</Button>
    </DialogContent></Dialog>)
}
