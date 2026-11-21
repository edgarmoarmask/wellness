// Administration: staff logins and roles (admin only). Also the "change my password" dialog used by everyone.
import { useEffect, useState } from "react"
import { UserCog, Plus, Pencil, KeyRound, ShieldCheck, Wand2, Copy, UserX, UserCheck } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input, NativeSelect, Label } from "@/components/ui/input"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Table, THead, TR, TH, TD } from "@/components/ui/table"
import { PageHead } from "@/components/kit"
import { useStore } from "@/lib/store"
import { ROLES } from "@data/users.js"
import { ROLE_INFO, checkUser, checkPassword, tempPassword, roleLabel, normRole } from "@/lib/users"

const Err = ({ children }) => (children ? <p className="text-sm font-semibold text-destructive" role="alert">{children}</p> : null)
const when = (s) => (s ? new Date(s).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never")

function PasswordField({ value, onChange, label = "Temporary password" }) {
  return <Label>{label}<div className="flex gap-2"><Input value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" autoComplete="new-password" />
    <Button type="button" variant="outline" title="Generate" onClick={() => onChange(tempPassword())}><Wand2 />Generate</Button>
    <Button type="button" variant="ghost" title="Copy" aria-label="Copy password" onClick={() => navigator.clipboard?.writeText(value)}><Copy /></Button></div>
    <span className="text-xs font-normal text-muted-foreground">At least 10 characters with letters and numbers. Give it to the person privately; they can change it after signing in.</span></Label>
}

function UserDialog({ user, me, onClose, onSaved }) {
  const st = useStore(), editing = user !== "new"
  const [f, setF] = useState(() => (editing ? { name: user.name, email: user.email, role: normRole(user.role), active: user.active } : { name: "", email: "", role: "therapist", password: tempPassword(), active: true }))
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false)
  const set = (p) => { setF((o) => ({ ...o, ...p })); setErr("") }
  const self = editing && user.email === me
  const chk = checkUser(f).error || (!editing && checkPassword(f.password))
  const save = async (e) => { e.preventDefault(); setBusy(true); const r = await st.saveUser(f, editing ? user.id : undefined, me); setBusy(false); if (r.error) return setErr(r.error); onSaved(); onClose() }
  return (
    <DialogContent className="max-w-xl" title={editing ? `Edit · ${user.name}` : "Add user"} description={editing ? user.email : "Creates a login. They sign in with email, password and a one-time code."}>
      <form onSubmit={save} className="grid gap-3">
        <Label>Full name *<Input value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus /></Label>
        <Label>Email (used to sign in and receive the code) *<Input type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} /></Label>
        <div className="grid gap-1.5"><span className="text-sm font-semibold">Role *</span>
          <div className="grid gap-2 sm:grid-cols-2">{Object.entries(ROLES).map(([k, v]) => <label key={k} className={`flex cursor-pointer gap-2 rounded-xl border p-3 text-sm ${f.role === k ? "border-primary bg-accent" : ""} ${self && k !== "admin" ? "cursor-not-allowed opacity-50" : ""}`}>
            <input type="radio" name="role" className="mt-0.5 accent-[#1f7a3f]" checked={f.role === k} disabled={self && k !== "admin"} onChange={() => set({ role: k })} /><span><b>{v.en}</b><span className="block text-xs text-muted-foreground">{ROLE_INFO[k]}</span></span></label>)}</div></div>
        {!editing && <PasswordField value={f.password} onChange={(password) => set({ password })} />}
        {editing && <label className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${self ? "opacity-50" : "cursor-pointer"}`}><input type="checkbox" className="size-4 accent-[#1f7a3f]" disabled={self} checked={f.active} onChange={(e) => set({ active: e.target.checked })} />Active (can sign in){!f.active && " — signed out on every device when saved"}</label>}
        {self && <p className="text-xs text-muted-foreground">This is you: your own role and status can only be changed by another admin.</p>}
        <Err>{err || (f.name && f.email && chk)}</Err>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!!chk || busy}>{editing ? "Save changes" : "Create login"}</Button></div>
      </form>
    </DialogContent>)
}

function ResetDialog({ user, onClose }) {
  const st = useStore(), [pw, setPw] = useState(tempPassword), [err, setErr] = useState("")
  return <DialogContent title={`Reset password · ${user.name}`} description={`${user.email} · signed out on every device; they sign in with the new password.`}>
    <PasswordField value={pw} onChange={(v) => { setPw(v); setErr("") }} label="New password" /><Err>{err}</Err>
    <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!!checkPassword(pw)} onClick={async () => { const e = await st.resetUserPassword(user.id, pw); if (e) return setErr(e); onClose() }}><KeyRound />Reset password</Button></div>
  </DialogContent>
}

/** any signed-in user */
export function ChangePasswordDialog({ me, onClose }) {
  const st = useStore(), [cur, setCur] = useState(""), [pw, setPw] = useState(""), [pw2, setPw2] = useState(""), [err, setErr] = useState("")
  const chk = !cur ? "Enter your current password" : checkPassword(pw) || (pw !== pw2 ? "The two new passwords don't match" : null)
  return <DialogContent title="Change my password" description={st.mode === "live" ? "You'll be signed out everywhere and sign in again with the new password." : me}>
    <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); const r = await st.changeMyPassword(cur, pw, me); if (r) return setErr(r); onClose() }}>
      <Label>Current password<Input type="password" autoComplete="current-password" value={cur} onChange={(e) => { setCur(e.target.value); setErr("") }} autoFocus /></Label>
      <Label>New password<Input type="password" autoComplete="new-password" value={pw} onChange={(e) => { setPw(e.target.value); setErr("") }} /><span className="text-xs font-normal text-muted-foreground">At least 10 characters with letters and numbers.</span></Label>
      <Label>New password again<Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => { setPw2(e.target.value); setErr("") }} /></Label>
      <Err>{err || (pw && pw2 && chk)}</Err>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!!chk}><KeyRound />Change password</Button></div></form>
  </DialogContent>
}

export function Administration({ me }) {
  const st = useStore(), [users, setUsers] = useState([]), [edit, setEdit] = useState(null), [reset, setReset] = useState(null), [loading, setLoading] = useState(true)
  const load = async () => { setUsers(await st.listUsers()); setLoading(false) }
  useEffect(() => { load() }, [st.mode, st.S.USERS])   // eslint-disable-line react-hooks/exhaustive-deps
  const counts = Object.keys(ROLES).map((k) => [k, users.filter((u) => u.active && normRole(u.role) === k).length])
  return (
    <div className="grid gap-5">
      <PageHead icon={UserCog} tone="violet" title="Administration" sub="Staff logins and roles. Each person gets their own login, so the audit log shows who did what."
        right={<Button onClick={() => setEdit("new")}><Plus />Add user</Button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{counts.map(([k, n]) => <Card key={k}><CardContent className="grid gap-1 p-4"><span className="font-display text-2xl font-bold">{n}</span><span className="text-sm font-semibold">{ROLES[k].en}</span><span className="text-xs text-muted-foreground">{ROLE_INFO[k]}</span></CardContent></Card>)}</div>
      <Card><CardHeader><CardTitle><ShieldCheck className="size-4 text-herb" />Users <span className="text-sm font-normal text-muted-foreground">· {users.filter((u) => u.active).length} active</span></CardTitle></CardHeader><CardContent className="p-0"><Table>
        <THead><tr><TH>Name</TH><TH>Role</TH><TH>Status</TH><TH>Last sign-in</TH><TH /></tr></THead>
        <tbody>{loading ? <TR><TD colSpan={5} className="p-6 text-center text-sm text-muted-foreground">Loading…</TD></TR> : users.map((u) => (
          <TR key={u.id} className={u.active ? "" : "opacity-60"}><TD><b>{u.name}</b>{u.email === me && <Badge variant="info" className="ml-2">You</Badge>}<div className="text-xs text-muted-foreground">{u.email}</div></TD>
            <TD><Badge variant={normRole(u.role) === "admin" ? "herb" : "muted"}>{roleLabel(u.role)}</Badge></TD>
            <TD>{u.active ? <Badge variant="ok"><UserCheck />Active</Badge> : <Badge variant="danger"><UserX />Deactivated</Badge>}</TD>
            <TD className="text-sm text-muted-foreground">{st.mode === "live" ? when(u.lastLoginAt) : "—"}</TD>
            <TD className="text-right"><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => setEdit(u)}><Pencil />Edit</Button><Button size="sm" variant="ghost" onClick={() => setReset(u)}><KeyRound />Reset password</Button></div></TD></TR>))}</tbody></Table>
        {st.mode !== "live" && <p className="border-t p-4 text-xs text-muted-foreground">Demo mode: users are saved in this browser. They can sign in here with their password and the demo code 246810. On the clinic server each person gets a real code by email.</p>}
      </CardContent></Card>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>{edit && <UserDialog key={edit === "new" ? "new" : edit.id} user={edit} me={me} onClose={() => setEdit(null)} onSaved={load} />}</Dialog>
      <Dialog open={!!reset} onOpenChange={(o) => !o && setReset(null)}>{reset && <ResetDialog user={reset} onClose={() => setReset(null)} />}</Dialog>
    </div>)
}
