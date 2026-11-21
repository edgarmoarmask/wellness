import { useEffect, useState } from "react"
import { Cloud, CloudOff, HardDrive, Scale, BookOpen, Percent, Download, ListTree, ChevronDown, Users, LayoutDashboard, CalendarClock, Stethoscope, Flower2, Pill, Receipt, ShieldCheck, Landmark, Sparkles, LogOut, Menu, RotateCcw, ShieldPlus, KeyRound, Mail, Lock, ArrowRight, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input, Label } from "@/components/ui/input"
import { TONES } from "@/components/kit"
import { useLang } from "@/lib/i18n"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { CLINIC } from "@data/clinic.js"
import { DEMO_USERS, ROLES } from "@data/users.js"
import clientLogo from "@/assets/dhanwanthari-logo.jpg"
import lnLogo from "@/assets/levinova-icon.png"
import Dashboard from "@/pages/Dashboard"
import { Appointments, Consult } from "@/pages/Front"
import { Packages, Pharmacy, Billing } from "@/pages/Ops"
import { Assistant } from "@/pages/Finance"
import { Transactions, Reports, Ledger, SST, Downloads, ChartOfAccounts } from "@/pages/Accounting"
import { Patients } from "@/pages/Patients"
import { Administration, ChangePasswordDialog } from "@/pages/Admin"
import { Attendance, ClockButton } from "@/pages/Attendance"
import { Dialog } from "@/components/ui/dialog"
import { canSee, roleLabel } from "@/lib/users"
import { UserCog, Clock as ClockIcon } from "lucide-react"

const NAV = [
  ["dashboard", LayoutDashboard, "Dashboard", "Papan pemuka", "violet"],
  ["patients", Users, "Patients", "Pesakit", "herb"],
  ["appointments", CalendarClock, "Appointments & queue", "Temu janji & giliran", "blue"],
  ["consult", Stethoscope, "Consultation", "Konsultasi", "herb"],
  ["packages", Flower2, "Wellness & packages", "Kesejahteraan & pakej", "pink"],
  ["pharmacy", Pill, "Pharmacy & stock", "Farmasi & stok", "gold"],
  ["billing", Receipt, "Billing", "Bil", "amber"],
  ["acc-transactions", Receipt, "Transactions", "", "herb", "accounting"],
  ["acc-reports", Scale, "Reports (P&L, balance sheet)", "", "blue", "accounting"],
  ["acc-ledger", BookOpen, "General ledger", "", "violet", "accounting"],
  ["acc-sst", Percent, "SST (service tax)", "", "amber", "accounting"],
  ["acc-downloads", Download, "Downloads for accountant", "", "cyan", "accounting"],
  ["acc-coa", ListTree, "Chart of accounts", "", "blue", "accounting"],
  ["assistant", Sparkles, "AI assistant", "Pembantu AI", "violet"],
  ["attendance", ClockIcon, "Attendance", "Kehadiran", "blue"],
  ["admin-users", UserCog, "Administration", "Pentadbiran", "violet"],
]
const route = () => { const h = location.hash.replace("#", ""); if (h === "accounts") return "acc-transactions"; return NAV.some((n) => n[0] === h) ? h : "dashboard" }


function Login({ onIn }) {
  const { x } = useLang(); const st = useStore(); const live = st.mode === "live"
  const [step, setStep] = useState(1); const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [otp, setOtp] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false); const [ch, setCh] = useState(null)
  const u = DEMO_USERS.find((d) => d.email === email.trim().toLowerCase())
  const next = async (e) => {
    e.preventDefault(); setErr("")
    if (live) {
      setBusy(true)
      try {
        if (step === 1) { const r = await st.login(email.trim().toLowerCase(), pw); if (r.error) return setErr(r.error); setCh(r.challengeId); if (r.devCode) setOtp(r.devCode); setStep(2) }
        else { const r = await st.verify(ch, otp); if (r.error) return setErr(r.error); onIn({ name: r.user.name, role: r.user.role, email: r.user.email }) }
      } finally { setBusy(false) }
      return
    }
    if (step === 1) { const du = await st.demoSignIn(email, pw); if (!du) return setErr(x("Email or password is not right.", "E-mel atau kata laluan tidak betul.")); setCh(du); setStep(2) } else { if (otp !== DEMO_USERS[0].otp) return setErr(x("Wrong code. Check your email.", "Kod salah. Semak e-mel anda.")); onIn({ name: ch.name, role: ch.role, email: ch.email }) }
  }
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-[#f2f9f4] via-white to-[#fbf3dc] p-10 lg:flex">
        <div className="flex items-center gap-2.5"><img src={lnLogo} alt="" className="size-9 rounded-xl" /><span className="font-display text-lg font-bold">LeviNova-<span className="ln-grad-text">AI</span></span></div>
        <div className="grid justify-items-center gap-5 text-center">
          <img src={clientLogo} alt={CLINIC.name} className="size-56 rounded-full bg-white object-contain p-2 shadow-xl ring-4 ring-gold-soft" />
          <div><h1 className="text-3xl font-bold text-herb">{CLINIC.name}</h1><p className="mt-1 text-muted-foreground">{x("Since", "Sejak")} {CLINIC.since}</p></div>
          <div className="flex flex-wrap justify-center gap-2 text-xs font-semibold">{[[Stethoscope, x("Vaidya consultation", "Konsultasi Vaidya")], [Flower2, "Panchakarma"], [Pill, x("Pharmacy", "Farmasi")], [Flower2, x("Wellness therapies", "Terapi kesejahteraan")]].map(([I, l]) => <span key={l} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-herb shadow-sm"><I className="size-3.5" />{l}</span>)}</div>
        </div>
        <p className="text-xs text-muted-foreground">{x("Patient data hosted in Malaysia · PDPA 2010", "Data pesakit dihoskan di Malaysia · PDPA 2010")}</p>
      </div>
      <div className="flex items-center justify-center bg-white p-6">
        <form onSubmit={next} className="grid w-full max-w-sm gap-4">
          <img src={clientLogo} alt="" className="size-16 rounded-full lg:hidden" />
          <div><h2 className="text-2xl font-bold">{step === 1 ? x("Sign in", "Log masuk") : x("Enter your code", "Masukkan kod anda")}</h2><p className="text-sm text-muted-foreground">{step === 1 ? x("Use your clinic account.", "Gunakan akaun klinik anda.") : x("We sent a 6-digit code to your email.", "Kami menghantar kod 6 digit ke e-mel anda.")}</p></div>
          {step === 1 ? <>
            <Label>{x("Email", "E-mel")}<div className="relative"><Mail className="absolute top-3 left-3 size-4 text-muted-foreground" /><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" required /></div></Label>
            <Label>{x("Password", "Kata laluan")}<div className="relative"><Lock className="absolute top-3 left-3 size-4 text-muted-foreground" /><Input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} className="pl-9" required /></div></Label>
          </> : <Label>{x("6-digit code", "Kod 6 digit")}<div className="relative"><KeyRound className="absolute top-3 left-3 size-4 text-muted-foreground" /><Input inputMode="numeric" maxLength={6} autoFocus value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} className="pl-9 font-mono tracking-[.3em]" /></div></Label>}
          {err && <p className="text-sm font-semibold text-destructive" role="alert">{err}</p>}
          <Button size="lg" type="submit">{step === 1 ? x("Continue", "Teruskan") : x("Sign in", "Log masuk")}<ArrowRight /></Button>
          <ModeChip mode={st.mode} />
          {!live && <div className="rounded-xl border border-dashed bg-muted/50 p-3 text-xs text-muted-foreground"><b className="text-foreground">{x("Demo account", "Akaun demo")}</b><div className="mt-1 font-mono">{DEMO_USERS[0].email} · {DEMO_USERS[0].password} · OTP {DEMO_USERS[0].otp}</div>
            <button type="button" onClick={() => { setEmail(DEMO_USERS[0].email); setPw(DEMO_USERS[0].password); if (step === 2) setOtp(DEMO_USERS[0].otp) }} className="mt-2 inline-flex cursor-pointer items-center gap-1 font-semibold text-primary"><Wand2 className="size-3.5" />{x("Fill demo details", "Isi butiran demo")}</button></div>}
          <p className="text-center text-[11px] text-muted-foreground">{x("Powered by", "Dikuasakan oleh")} LeviNova-AI · medical.levinova-ai.com</p>
        </form>
      </div>
    </div>)
}

/** Live = saved on the clinic server; Demo = this browser only. */
function ModeChip({ mode, wide }) {
  if (mode === "checking") return null
  if (mode === "live") return <div className={cn("flex items-center gap-2 rounded-xl bg-[#e3f6ee] px-3 py-2 text-xs font-semibold text-ok", wide && "rounded-full py-1.5")}><Cloud className="size-4" />Connected to clinic server · data saved securely</div>
  if (mode === "offline") return <div className="flex items-center gap-2 rounded-xl bg-[#fee2e2] px-3 py-2 text-xs font-semibold text-destructive"><CloudOff className="size-4" />Clinic server not reachable. Check the internet connection or contact support.</div>
  return <div className={cn("flex items-center gap-2 rounded-xl bg-[#fdf1dc] px-3 py-2 text-xs font-semibold text-warn", wide && "rounded-full py-1.5")}><HardDrive className="size-4" />Demo mode · data saved in this browser only</div>
}

export default function App() {
  const { x } = useLang(); const st = useStore(); const { S, toast } = st
  const [localUser, setUser] = useState(() => { try { return JSON.parse(sessionStorage.getItem("dvc.session")) } catch { return null } })
  const user = st.mode === "live" ? st.auth?.user ?? null : st.mode === "demo" ? localUser : null
  const [page, setPage] = useState(route); const [consultId, setConsultId] = useState(null); const [patientId, setPatientId] = useState(null); const [menu, setMenu] = useState(false); const [accOpen, setAccOpen] = useState(false); const [pwOpen, setPwOpen] = useState(false)
  useEffect(() => { const f = () => { const r = route(); setPage(r); if (r !== "patients") setPatientId(null); setMenu(false); window.scrollTo(0, 0) }; addEventListener("hashchange", f); return () => removeEventListener("hashchange", f) }, [])
  useEffect(() => { const n = NAV.find((q) => q[0] === page); document.title = `${x(n[2], n[3])} · ${CLINIC.short} · LeviNova-AI` }, [page, x])
  const go = (k) => { if (location.hash !== "#" + k) location.hash = k; else setPage(k) }
  const openConsult = (id) => { setConsultId(id); go("consult") }
  const openPatient = (id) => { setPatientId(id); go("patients"); window.scrollTo(0, 0) }
  if (st.mode === "checking") return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Connecting…</div>
  if (!user) return <Login onIn={(u) => { if (st.mode !== "live") { setUser(u); try { sessionStorage.setItem("dvc.session", JSON.stringify(u)) } catch {} } }} />
  const badge = { appointments: S.Q.filter((v) => v.status === "waiting").length, consult: S.Q.filter((v) => v.status === "consult").length, pharmacy: S.Q.filter((v) => v.status === "dispense").length, billing: S.Q.filter((v) => v.status === "billing").length, acc: (S.TX ?? []).filter((t) => t.status === "pending").length }
  const Side = (
    <nav className="grid gap-4">
      <div className="flex items-center gap-2.5 px-1"><img src={lnLogo} alt="" className="size-10 rounded-xl" /><div><div className="font-display text-lg leading-tight font-bold">LeviNova-<span className="ln-grad-text">AI</span></div><div className="text-[10px] font-semibold tracking-[.14em] text-muted-foreground">{x("CLINIC SYSTEM", "SISTEM KLINIK")}</div></div></div>
      <div className="flex items-center gap-2.5 rounded-2xl border bg-gradient-to-r from-herb-soft to-gold-soft/60 p-2"><img src={clientLogo} alt={CLINIC.name} className="size-11 rounded-full bg-white object-contain" /><div className="min-w-0"><div className="truncate text-sm leading-tight font-bold text-herb">{CLINIC.short}</div><div className="truncate text-[11px] text-muted-foreground">{x("Ayurveda Vaidyasala", "Ayurveda Vaidyasala")} · {x("since", "sejak")} {CLINIC.since}</div><div className="flex items-center gap-1 text-[11px] text-ok"><ShieldPlus className="size-3" />{x("Hosted in Malaysia", "Dihoskan di Malaysia")}</div></div></div>
      <div className="grid gap-0.5">{(() => {
        const item = ([k, I, en, ms, tone], sub) => { const on = page === k, [bg, fg] = TONES[tone]; return (
          <a key={k} href={"#" + k} onClick={() => k === "patients" && setPatientId(null)} aria-current={on ? "page" : undefined} className={cn("flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm font-semibold transition", sub && "ml-4 py-1 text-[13px]", on ? "bg-accent text-primary" : "text-foreground/80 hover:bg-muted")}>
            <span className={cn("grid shrink-0 place-items-center rounded-lg", sub ? "size-7" : "size-8")} style={on ? { background: "var(--primary)", color: "#fff" } : { background: bg, color: fg }}><I className="size-4" /></span><span className="flex-1 truncate">{x(en, ms)}</span>
            {badge[k] > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-warn px-1.5 text-[11px] font-bold text-white">{badge[k]}</span>}</a>) }
        const mine = NAV.filter((n) => canSee(user.role, n[0]))
        const top = mine.filter((n) => !n[5]), kids = mine.filter((n) => n[5] === "accounting"), inAcc = page.startsWith("acc-"), open = accOpen || inAcc
        const at = Math.max(top.findIndex((n) => n[0] === "billing"), top.findIndex((n) => n[0] === "pharmacy"), top.findIndex((n) => n[0] === "packages")) + 1
        return <>{top.slice(0, at).map((n) => item(n))}{kids.length > 0 && <>
          <button onClick={() => setAccOpen(!open)} aria-expanded={open} className={cn("flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm font-semibold", inAcc ? "text-primary" : "text-foreground/80 hover:bg-muted")}>
            <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: TONES.blue[0], color: TONES.blue[1] }}><Landmark className="size-4" /></span><span className="flex-1">Accounting</span>{(badge.acc ?? 0) > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-warn px-1.5 text-[11px] font-bold text-white">{badge.acc}</span>}<ChevronDown className={cn("size-4 transition", open && "rotate-180")} /></button>
          {open && <div className="grid gap-0.5 border-l-2 border-border/70 ml-6 pl-0">{kids.map((n) => item(n, true))}</div>}</>}
          {top.slice(at).map((n) => item(n))}</>
      })()}</div>
      {st.mode !== "live" && <button onClick={() => { if (confirm("Clear ALL data entered in this browser (patients, visits, packages, payments)? This cannot be undone.")) { st.reset(); setConsultId(null); setPatientId(null) } }} className="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"><RotateCcw className="size-4" />Clear all data (demo)</button>}
    </nav>)
  const P = { go, openConsult, openPatient, patientId, me: user }
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-[17rem] shrink-0 overflow-y-auto border-r bg-white p-4 md:block print:hidden">{Side}</aside>
      {menu && <div className="fixed inset-0 z-40 bg-[#12132e]/40 backdrop-blur-sm md:hidden" onClick={() => setMenu(false)}><aside className="h-full w-72 overflow-y-auto bg-white p-4" onClick={(e) => e.stopPropagation()}>{Side}</aside></div>}
      <main className="mx-auto w-full max-w-7xl min-w-0 flex-1 p-4 md:p-8">
        <header className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
          <button className="grid size-10 place-items-center rounded-xl border bg-white md:hidden" onClick={() => setMenu(true)} aria-label="Menu"><Menu className="size-5" /></button>
          <div className="flex items-center gap-2.5 rounded-full border bg-white py-1 pr-4 pl-1 shadow-sm"><span className="grid size-8 place-items-center rounded-full ln-grad text-xs font-bold text-white">{user.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</span><div className="leading-tight"><div className="text-sm font-bold">{user.name}</div><div className="text-[11px] text-muted-foreground">{roleLabel(user.role)}</div></div></div>
          <div className="hidden lg:block"><ModeChip mode={st.mode} wide /></div>
          <div className="ml-auto flex items-center gap-2">
            <ClockButton me={user} />
            <button onClick={() => setPwOpen(true)} title="Change my password" aria-label="Change my password" className="grid size-10 cursor-pointer place-items-center rounded-full border bg-white shadow-sm hover:border-primary hover:text-primary"><KeyRound className="size-[18px]" /></button>
            <button onClick={() => { if (st.mode === "live") st.logout(); setUser(null); try { sessionStorage.removeItem("dvc.session") } catch {} }} title={x("Sign out", "Log keluar")} aria-label={x("Sign out", "Log keluar")} className="grid size-10 cursor-pointer place-items-center rounded-full border bg-white shadow-sm hover:border-primary hover:text-primary"><LogOut className="size-[18px]" /></button></div>
          <Dialog open={pwOpen} onOpenChange={setPwOpen}>{pwOpen && <ChangePasswordDialog me={user.email} onClose={() => setPwOpen(false)} />}</Dialog>
        </header>
        {!canSee(user.role, page) ? <div className="grid justify-items-center gap-3 rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground"><ShieldCheck className="size-8 text-muted-foreground" /><b className="text-foreground">This page isn't part of the {roleLabel(user.role)} role.</b>Ask an admin if you need access.<Button variant="outline" onClick={() => go("dashboard")}>Go to dashboard</Button></div> : <>
        {page === "dashboard" && <Dashboard {...P} />}{page === "patients" && <Patients {...P} />}{page === "appointments" && <Appointments {...P} />}{page === "consult" && <Consult id={consultId} back={() => setConsultId(null)} {...P} />}
        {page === "packages" && <Packages {...P} />}{page === "pharmacy" && <Pharmacy {...P} />}{page === "billing" && <Billing {...P} />}
        {page === "acc-transactions" && <Transactions {...P} />}{page === "acc-reports" && <Reports {...P} />}{page === "acc-ledger" && <Ledger {...P} />}{page === "acc-sst" && <SST {...P} />}{page === "acc-downloads" && <Downloads {...P} />}{page === "acc-coa" && <ChartOfAccounts {...P} />}{page === "admin-users" && <Administration me={user.email} />}{page === "attendance" && <Attendance me={user} />}{page === "assistant" && <Assistant {...P} />}</>}
        <footer className="mt-10 text-center text-[11px] text-muted-foreground">{CLINIC.name} × LeviNova-AI · {CLINIC.whatsapp} · {CLINIC.email}</footer>
      </main>
      {toast && <div role="status" className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-[#12132e] px-5 py-3 text-sm font-semibold text-white shadow-2xl">{x(toast.msg.en, toast.msg.ms)}</div>}
    </div>)
}
