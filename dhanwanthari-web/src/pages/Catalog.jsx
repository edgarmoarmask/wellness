// Wellness therapy menu and package catalogue: add / edit / delete, CSV bulk upload, templates and export.
// A package = several therapies (each with a number of sessions) sold at one package price.
import { useMemo, useRef, useState } from "react"
import { Plus, Pencil, Trash2, Upload, Download, FileSpreadsheet, Search, CheckCircle2, Leaf, Gift, X, AlertTriangle, ShoppingCart, Clock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input, NativeSelect, Label } from "@/components/ui/input"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Table, THead, TR, TH, TD } from "@/components/ui/table"
import { IconChip, ServiceOptions } from "@/components/kit"
import { useStore } from "@/lib/store"
import { rm, rm0, cn } from "@/lib/utils"
import { minDeposit, packageSessionValue, packageState, therapyName } from "@/lib/rules"
import { GROUPS, LABELS, THERAPY_COLUMNS, PACKAGE_COLUMNS, checkTherapy, checkPackage, packageValue, readTherapyCsv, readPackageCsv, therapyTemplateCsv, therapyExportCsv, packageTemplateCsv, packageExportCsv } from "@/lib/catalog"
import { saveBlob } from "./Accounting"

const csvBlob = (text) => new Blob([text], { type: "text/csv;charset=utf-8" })
const stamp = () => new Date().toISOString().slice(0, 10)
const GROUP_OF = { "Wellness offer": "wellness", "Wellness package": "wellness", "Walk-in treatment": "walkin", "Add-on": "walkin" }
const tName = (list, id) => list.find((s) => s.id === id)
const ORDER = ["Wellness offer", "Walk-in treatment"]
/** same order in demo and live: group (offers, walk-in, add-ons), then name */
export const sortTherapies = (list) => [...list].sort((a, b) => (ORDER.indexOf(a.group) + 1 || 9) - (ORDER.indexOf(b.group) + 1 || 9) || a.name.en.localeCompare(b.name.en))
const Err = ({ children }) => (children ? <p className="text-sm font-semibold text-destructive" role="alert">{children}</p> : null)

// ------------------------------------------------------------------ shared CSV upload dialog
function CsvDialog({ title, description, help, template, current, read, onImport, onClose }) {
  const inp = useRef(null)
  const [file, setFile] = useState(""), [res, setRes] = useState(null), [busy, setBusy] = useState(false), [serverErr, setServerErr] = useState(null)
  const pick = async (e) => { const fl = e.target.files?.[0]; if (!fl) return; if (fl.size > 2_000_000) { setRes({ error: "File is larger than 2 MB." }); return } setFile(fl.name); setServerErr(null); setRes(read(await fl.text())); e.target.value = "" }
  const rows = res?.rows ?? [], ok = rows.filter((r) => !r.error && r.action !== "same"), bad = rows.filter((r) => r.error)
  const count = (a) => rows.filter((r) => !r.error && r.action === a).length
  const sorted = [...rows].sort((a, b) => (b.error ? 1 : 0) - (a.error ? 1 : 0) || (a.action === "same") - (b.action === "same") || a.line - b.line)
  const go = async () => { setBusy(true); const r = await onImport(ok); setBusy(false); if (r?.error) return setServerErr(r.errors?.length ? r.errors : [{ row: "-", message: r.error }]); onClose() }
  return (
    <DialogContent className="max-w-3xl" title={title} description={description}>
      <div className="grid gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">{help}
        <div className="flex flex-wrap gap-2 pt-1"><Button size="sm" variant="outline" type="button" onClick={template}><FileSpreadsheet />Download template</Button><Button size="sm" variant="outline" type="button" onClick={current}><Download />Current list as CSV (edit &amp; re-upload)</Button></div></div>
      <input ref={inp} type="file" accept=".csv,text/csv" className="hidden" onChange={pick} />
      <button type="button" onClick={() => inp.current?.click()} className="grid cursor-pointer justify-items-center gap-1 rounded-2xl border-2 border-dashed p-6 text-sm font-semibold hover:border-primary hover:text-primary"><Upload className="size-6" />{file ? `${file} · choose another file` : "Choose CSV file"}<span className="text-xs font-normal text-muted-foreground">Saved from Excel or Google Sheets as CSV · max 2,000 rows</span></button>
      <Err>{res?.error}</Err>
      {rows.length > 0 && <>
        <div className="flex flex-wrap gap-2 text-xs"><Badge variant="ok">{count("add")} new</Badge><Badge variant="info">{count("update")} updated</Badge><Badge variant="muted">{count("same")} no change</Badge>{bad.length > 0 && <Badge variant="danger">{bad.length} with errors (skipped)</Badge>}</div>
        <div className="max-h-72 overflow-auto rounded-xl border"><Table><THead><tr><TH>Row</TH><TH>Name</TH><TH>Result</TH><TH className="text-right">Price</TH></tr></THead>
          <tbody>{sorted.map((r) => <TR key={r.line} className={r.error ? "bg-[#fee2e2]/40" : ""}><TD>{r.lines ?? r.line}</TD><TD><b>{r.name || "—"}</b>{r.id && <div className="text-xs text-muted-foreground">{r.id}</div>}{r.d?.items && <div className="text-xs text-muted-foreground">{r.d.sessions} sessions</div>}</TD>
            <TD>{r.error ? <span className="text-xs font-semibold text-destructive">{r.error}</span> : <Badge variant={r.action === "add" ? "ok" : r.action === "update" ? "info" : "muted"}>{{ add: "New", update: "Update", same: "No change" }[r.action]}</Badge>}</TD>
            <TD className="text-right">{r.d ? <>{r.before && r.before.price !== r.d.price ? <span className="text-muted-foreground line-through">{rm(r.before.price)}</span> : null} {rm(r.d.price)}</> : ""}</TD></TR>)}</tbody></Table></div></>}
      {serverErr && <div className="grid gap-1 text-sm text-destructive" role="alert">{serverErr.map((e, i) => <div key={i}>Row {e.row}: {e.message}</div>)}</div>}
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!ok.length || busy} onClick={go}><CheckCircle2 />{busy ? "Importing…" : `Import ${ok.length} row${ok.length === 1 ? "" : "s"}`}</Button></div>
    </DialogContent>)
}

function ConfirmDelete({ title, text, onDelete, onClose }) {
  const [err, setErr] = useState("")
  return <DialogContent title={title} description={text}><Err>{err}</Err>
    <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="destructive" onClick={async () => { const e = await onDelete(); if (e) return setErr(e.en ?? e); onClose() }}><Trash2 />Delete</Button></div></DialogContent>
}

// ------------------------------------------------------------------ therapies
const T_EMPTY = { code: "", name: "", group: "walkin", mins: "60", price: "", normal: "", label: "", benefits: "", advance: false }
const toTForm = (s) => ({ code: s.code ?? "", name: s.name.en, group: GROUP_OF[s.group] ?? "walkin", mins: s.mins == null ? "" : String(s.mins), price: String(s.price), normal: s.normal == null ? "" : String(s.normal), label: s.label ?? "", benefits: s.benefits?.en ?? "", advance: !!s.advance })

function TherapyDialog({ item, onClose }) {
  const st = useStore(), editing = item !== "new"
  const [f, setF] = useState(() => (editing ? toTForm(item) : T_EMPTY)), [err, setErr] = useState("")
  const set = (p) => { setF((o) => ({ ...o, ...p })); setErr("") }
  const chk = checkTherapy(f, { id: editing ? item.id : undefined, all: st.S.SVC })
  const save = async (e) => { e.preventDefault(); const r = await st.saveTherapy(f, editing ? item.id : undefined); if (r?.error) return setErr(r.error); onClose() }
  return (
    <DialogContent className="max-w-2xl" title={editing ? `Edit · ${item.name.en}` : "Add therapy"} description={editing ? `Therapy id ${item.id}. Price changes apply to new visits.` : "A treatment on the therapy menu. Can be booked on its own or put into packages."}>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <Label className="sm:col-span-2">Therapy name *<Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Shirodhara" autoFocus /></Label>
        <Label>Code<Input value={f.code} onChange={(e) => set({ code: e.target.value })} placeholder="e.g. SD" /><span className="text-xs font-normal text-muted-foreground">Short code from the price list. Used in the CSV for packages.</span></Label>
        <Label>Group *<NativeSelect value={f.group} onChange={(e) => set({ group: e.target.value })}>{Object.entries(GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Label>
        <Label>Duration (minutes)<Input inputMode="numeric" value={f.mins} onChange={(e) => set({ mins: e.target.value })} placeholder="blank = to confirm" /></Label>
        <Label>Price charged (RM) *<Input inputMode="decimal" value={f.price} onChange={(e) => set({ price: e.target.value })} /></Label>
        <Label>Normal price (RM)<Input inputMode="decimal" value={f.normal} onChange={(e) => set({ normal: e.target.value })} placeholder="only for offers" /><span className="text-xs font-normal text-muted-foreground">Shown crossed out, with the % saved.</span></Label>
        <Label>Offer label<NativeSelect value={f.label} onChange={(e) => set({ label: e.target.value })}>{Object.entries(LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Label>
        <Label className="sm:col-span-2">Benefits (shown on the wellness card)<textarea className="min-h-20 rounded-xl border bg-white p-3 text-sm font-normal" value={f.benefits} onChange={(e) => set({ benefits: e.target.value })} /></Label>
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm sm:col-span-2"><input type="checkbox" className="size-4 accent-[#1f7a3f]" checked={f.advance} onChange={(e) => set({ advance: e.target.checked })} />Book ahead (needs advance booking)</label>
        <div className="sm:col-span-2"><Err>{err || (f.name && chk.error)}</Err></div>
        <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!!chk.error}>{editing ? "Save changes" : "Add therapy"}</Button></div>
      </form>
    </DialogContent>)
}

export function TherapyMenuCard() {
  const st = useStore(), { S } = st
  const [q, setQ] = useState(""), [grp, setGrp] = useState(""), [edit, setEdit] = useState(null), [del, setDel] = useState(null), [imp, setImp] = useState(false)
  const active = sortTherapies(S.SVC.filter((s) => !s.archived))
  const list = useMemo(() => active.filter((s) => (!grp || GROUP_OF[s.group] === grp) && (!q || `${s.code ?? ""} ${s.name.en} ${s.id}`.toLowerCase().includes(q.toLowerCase()))), [active, q, grp])
  const inPk = (id) => S.PKG.filter((g) => !g.archived && (g.items ?? []).some((i) => i.svc === id))
  const tpl = () => saveBlob(csvBlob(therapyTemplateCsv()), "therapy-upload-template.csv")
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center gap-2"><CardTitle className="mr-auto"><Leaf className="size-4 text-herb" />Therapy menu <span className="text-sm font-normal text-muted-foreground">· {active.length} therapies</span></CardTitle>
        <Button size="sm" variant="outline" onClick={tpl}><FileSpreadsheet />Download template</Button>
        <Button size="sm" variant="outline" onClick={() => setImp(true)}><Upload />Upload CSV</Button>
        <Button size="sm" variant="herb" onClick={() => setEdit("new")}><Plus />Add therapy</Button></CardHeader>
      <CardContent className="grid gap-3 p-0">
        <div className="flex flex-wrap gap-2 px-6"><div className="relative min-w-56 flex-1"><Search className="absolute top-3 left-3 size-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search name or code" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <NativeSelect className="w-52" value={grp} onChange={(e) => setGrp(e.target.value)}><option value="">All groups</option>{Object.entries(GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect>
          <Button variant="ghost" onClick={() => saveBlob(csvBlob(therapyExportCsv(S.SVC)), `therapies-${stamp()}.csv`)}><Download />Export CSV</Button></div>
        <div className="max-h-[480px] overflow-auto"><Table>
          <THead><tr><TH>Therapy</TH><TH>Group</TH><TH className="text-right">Minutes</TH><TH className="text-right">Price</TH><TH>In packages</TH><TH /></tr></THead>
          <tbody>{list.length === 0 ? <TR><TD colSpan={6} className="py-8 text-center text-sm text-muted-foreground">{active.length ? "No therapies match." : "No therapies yet. Add one or upload a CSV."}</TD></TR> : list.map((s) => { const pk = inPk(s.id); return (
            <TR key={s.id}><TD><b>{s.code ? `${s.code} · ` : ""}{s.name.en}</b><div className="text-xs text-muted-foreground">{s.id}{s.advance ? " · book ahead" : ""}</div></TD>
              <TD><Badge variant={s.wellness ? "ok" : "muted"}>{s.group}</Badge></TD><TD className="text-right">{s.mins ?? <span className="text-muted-foreground">—</span>}</TD>
              <TD className="text-right"><b>{rm(s.price)}</b>{s.normal && <div className="text-xs text-muted-foreground"><s>{rm(s.normal)}</s> {s.label && LABELS[s.label]}</div>}</TD>
              <TD className="text-xs text-muted-foreground">{pk.map((g) => g.name.en).join(", ") || "—"}</TD>
              <TD className="text-right"><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" aria-label={`Edit ${s.name.en}`} onClick={() => setEdit(s)}><Pencil /></Button><Button size="sm" variant="ghost" className="text-destructive" aria-label={`Delete ${s.name.en}`} onClick={() => setDel(s)}><Trash2 /></Button></div></TD></TR>) })}</tbody></Table></div>
      </CardContent>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>{edit && <TherapyDialog key={edit === "new" ? "new" : edit.id} item={edit} onClose={() => setEdit(null)} />}</Dialog>
      <Dialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>{del && <ConfirmDelete title={`Delete ${del.name.en}?`} text="It is removed from the therapy menu and can no longer be booked. Past visits and invoices keep it." onDelete={() => st.deleteTherapy(del.id)} onClose={() => setDel(null)} />}</Dialog>
      <Dialog open={imp} onOpenChange={setImp}>{imp && <CsvDialog title="Upload therapies (CSV)" description="Add new therapies and update existing ones. Rows are matched by id, or by name when id is blank."
        help={<><div><b className="text-foreground">Columns:</b> {THERAPY_COLUMNS.join(", ")}</div><div><b className="text-foreground">Values:</b> group = wellness / walk-in · offer_label = promo / member / special / blank · normal_price = only for offers, higher than price · mins = blank if not fixed · book_ahead = yes / no</div></>}
        template={tpl} current={() => saveBlob(csvBlob(therapyExportCsv(S.SVC)), `therapies-${stamp()}.csv`)} read={(t) => readTherapyCsv(t, S.SVC)} onImport={st.importTherapies} onClose={() => setImp(false)} />}</Dialog>
    </Card>)
}

// ------------------------------------------------------------------ packages
function PackageDialog({ item, onClose }) {
  const st = useStore(), { S } = st, editing = item !== "new", ther = S.SVC.filter((s) => !s.archived)
  const [name, setName] = useState(editing ? item.name.en : ""), [price, setPrice] = useState(editing ? String(item.price) : "")
  const [kind, setKind] = useState(editing && !item.items?.length ? "flex" : "fixed")
  const [items, setItems] = useState(() => (editing && item.items?.length ? item.items.map((i) => ({ svc: i.svc, n: String(i.n) })) : [{ svc: ther[0]?.id ?? "", n: "5" }]))
  const [total, setTotal] = useState(editing && !item.items?.length ? String(item.sessions) : "")
  const [code, setCode] = useState(editing ? item.code ?? "" : ""), [duration, setDuration] = useState(editing ? item.duration ?? "" : "")
  const [validity, setValidity] = useState(editing && item.validityMonths ? String(item.validityMonths) : ""), [inc, setInc] = useState(editing ? (item.inclusions ?? []).join("\n") : "")
  const [err, setErr] = useState("")
  const flex = kind === "flex"
  const data = { code, name, price, duration, validityMonths: validity, inclusions: inc, ...(flex ? { items: [], sessions: total } : { items }) }
  const chk = checkPackage(data, { id: editing ? item.id : undefined, all: S.PKG, therapies: S.SVC })
  const sessions = flex ? Number(total) || 0 : items.reduce((a, i) => a + (Number(i.n) || 0), 0), { value } = flex ? { value: 0 } : packageValue(items.map((i) => ({ svc: i.svc, n: Number(i.n) || 0 })), S.SVC)
  const p = Number(price) || 0, save = Math.round((1 - p / (value || 1)) * 100)
  const setItem = (k, patch) => { setItems((o) => o.map((x, j) => (j === k ? { ...x, ...patch } : x))); setErr("") }
  const ch = (f) => (e) => { f(e.target.value); setErr("") }
  const submit = async (e) => { e.preventDefault(); const r = await st.savePackage(data, editing ? item.id : undefined); if (r?.error) return setErr(r.error); onClose() }
  return (
    <DialogContent className="max-w-2xl" title={editing ? `Edit package · ${item.name.en}` : "Add package"} description={editing ? "Changes apply to new sales. Clients who already bought it keep the terms they paid for." : "A set of therapies with sessions each, or a flexible plan with a total number of sessions."}>
      <form onSubmit={submit} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[140px_1fr]"><Label>Plan code<Input value={code} onChange={ch(setCode)} placeholder="e.g. PLAN 1" /></Label>
          <Label>Package name *<Input value={name} onChange={ch(setName)} placeholder="e.g. Spine Correction Program" autoFocus /></Label></div>
        <div className="grid grid-cols-2 gap-2">{[["fixed", "Set therapies", "Choose therapies and sessions of each"], ["flex", "Flexible plan", "Total sessions; any therapy or consultation recorded"]].map(([k, l, d]) =>
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setErr("") }} className={cn("grid cursor-pointer gap-0.5 rounded-xl border p-3 text-left text-sm", kind === k ? "border-herb bg-herb-soft" : "")}><b>{l}</b><span className="text-xs text-muted-foreground">{d}</span></button>)}</div>
        {flex ? <Label>Total sessions *<Input inputMode="numeric" value={total} onChange={ch(setTotal)} placeholder="e.g. 7" /></Label>
        : <div className="grid gap-2"><span className="text-sm font-semibold">Therapies in this package *</span>
          {items.map((it, k) => { const t = tName(S.SVC, it.svc); return (
            <div key={k} className="grid grid-cols-[1fr_150px_auto] items-center gap-2">
              <NativeSelect aria-label="Therapy" value={it.svc} onChange={(e) => setItem(k, { svc: e.target.value })}><ServiceOptions list={ther} rm={rm} /></NativeSelect>
              <div className="flex items-center gap-1"><Input aria-label="Sessions" inputMode="numeric" value={it.n} onChange={(e) => setItem(k, { n: e.target.value })} /><span className="text-xs text-muted-foreground">sessions</span></div>
              <Button type="button" size="sm" variant="ghost" aria-label="Remove therapy" disabled={items.length === 1} onClick={() => setItems((o) => o.filter((_, j) => j !== k))}><X /></Button>
              {t && <span className="col-span-3 -mt-1 text-xs text-muted-foreground">{t.mins ? `${t.mins} min · ` : ""}{rm(t.price)} each · {rm((t.price || 0) * (Number(it.n) || 0))} at menu price</span>}
            </div>) })}
          <Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={() => setItems((o) => [...o, { svc: ther.find((s) => !o.some((x) => x.svc === s.id))?.id ?? ther[0]?.id, n: "1" }])}><Plus />Add another therapy</Button></div>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Label>Package price (RM) *<Input inputMode="decimal" value={price} onChange={ch(setPrice)} /></Label>
          <Label>Duration<Input value={duration} onChange={ch(setDuration)} placeholder="e.g. 4 weeks" /></Label>
          <Label>Validity (months)<Input inputMode="numeric" value={validity} onChange={ch(setValidity)} placeholder="blank = no expiry" /></Label></div>
        <div className="grid content-center gap-1 rounded-xl bg-herb-soft/60 p-3 text-sm"><span><b>{sessions}</b> sessions{!flex && <> · menu value <b>{rm(value)}</b></>}{validity && Number(validity) > 0 ? ` · usable for ${validity} month${Number(validity) > 1 ? "s" : ""} from sale` : ""}</span>
          {p > 0 && sessions > 0 && <span className="text-xs text-muted-foreground">{rm(p / sessions)} per session{!flex && value > p ? ` · client saves ${save}%` : !flex && value < p ? " · above menu value" : ""} · deposit from {rm0(Math.ceil(p * 0.3))}</span>}</div>
        <Label>Inclusions (one per line, shown on the package card)<textarea className="min-h-24 rounded-xl border bg-white p-3 text-sm font-normal" value={inc} onChange={ch(setInc)} placeholder={"Three Ayurvedic consultation with Nadi pareeksha\nExercise and posture correction"} /></Label>
        <Err>{err || (name && price && chk.error)}</Err>
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" variant="herb" disabled={!!chk.error}>{editing ? "Save changes" : "Add package"}</Button></div>
      </form>
    </DialogContent>)
}

/** package cards with Sell / edit / delete, plus add, CSV upload and template */
export function PackageCatalog({ onSell }) {
  const st = useStore(), { S } = st
  const [edit, setEdit] = useState(null), [del, setDel] = useState(null), [imp, setImp] = useState(false)
  const list = S.PKG.filter((g) => !g.archived).sort((a, b) => (a.code ? 0 : 1) - (b.code ? 0 : 1) || (a.code ?? "").localeCompare(b.code ?? "", undefined, { numeric: true }) || a.price - b.price || a.name.en.localeCompare(b.name.en))   // brochure plans first (PLAN 1…5), then by price
  const tpl = () => saveBlob(csvBlob(packageTemplateCsv()), "package-upload-template.csv")
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center gap-2"><CardTitle className="mr-auto"><Gift className="size-4 text-[#db2777]" />Packages <span className="text-sm font-normal text-muted-foreground">· {list.length} on sale · each package is a set of therapies</span></CardTitle>
        <Button size="sm" variant="outline" onClick={tpl}><FileSpreadsheet />Download template</Button>
        <Button size="sm" variant="outline" onClick={() => setImp(true)}><Upload />Upload CSV</Button>
        <Button size="sm" variant="herb" onClick={() => setEdit("new")}><Plus />Add package</Button></CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{list.length === 0 && <p className="col-span-full py-6 text-center text-sm text-muted-foreground">No packages yet. Add one or upload a CSV.</p>}
        {list.map((g) => { const { value } = packageValue(g.items, S.SVC); return (
          <div key={g.id} className="ln-shadow grid content-start gap-2 rounded-2xl border bg-white p-4">
            <div className="flex items-start justify-between gap-2"><IconChip icon={Gift} tone="pink" /><div className="flex gap-0.5"><Button size="sm" variant="ghost" aria-label={`Edit ${g.name.en}`} onClick={() => setEdit(g)}><Pencil /></Button><Button size="sm" variant="ghost" className="text-destructive" aria-label={`Delete ${g.name.en}`} onClick={() => setDel(g)}><Trash2 /></Button></div></div>
            {g.code && <span className="text-[11px] font-bold tracking-wider text-muted-foreground">{g.code}</span>}
            <b className="-mt-1 leading-snug">{g.name.en}</b>
            {(g.duration || g.validityMonths) && <span className="text-xs"><b>{g.sessions}</b> sessions{g.duration ? ` · ${g.duration}` : ""}{g.validityMonths ? ` · valid ${g.validityMonths >= 12 && g.validityMonths % 12 === 0 ? `${g.validityMonths / 12} year${g.validityMonths > 12 ? "s" : ""}` : `${g.validityMonths} month${g.validityMonths > 1 ? "s" : ""}`}` : ""}</span>}
            {g.items?.length ? <ul className="grid gap-0.5 text-xs">{g.items.map((i) => { const t = tName(S.SVC, i.svc); return <li key={i.svc} className="flex justify-between gap-2"><span>{t?.code ? `${t.code} · ` : ""}{t?.name.en ?? i.svc}{t?.archived ? " (deleted)" : ""}</span><b>× {i.n}</b></li> })}</ul>
              : !g.inclusions?.length && <p className="rounded-lg bg-muted/60 p-2 text-[11px] text-muted-foreground">Flexible: any therapy or consultation is recorded against the {g.sessions} sessions.</p>}
            {g.inclusions?.length > 0 && <ul className="grid list-disc gap-0.5 pl-4 text-xs text-muted-foreground">{g.inclusions.map((x, k) => <li key={k}>{x}</li>)}</ul>}
            <span className="text-xs text-muted-foreground">{g.duration || g.validityMonths ? "" : `${g.sessions} sessions · `}{rm(packageSessionValue(g))} / session{value > g.price ? ` · saves ${Math.round((1 - g.price / value) * 100)}%` : ""}</span>
            <div className="flex items-baseline gap-2"><span className="font-display text-xl font-bold">{rm0(g.price)}</span>{value > g.price && <s className="text-sm text-muted-foreground">{rm0(value)}</s>}</div>
            <span className="text-[11px] text-muted-foreground">Deposit from {rm0(minDeposit(g))}</span>
            <Button size="sm" variant="outline" className="mt-auto" onClick={() => onSell(g.id)}><ShoppingCart />Sell</Button></div>) })}</CardContent>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>{edit && <PackageDialog key={edit === "new" ? "new" : edit.id} item={edit} onClose={() => setEdit(null)} />}</Dialog>
      <Dialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>{del && <ConfirmDelete title={`Delete ${del.name.en}?`} text={`It can no longer be sold. ${S.PK.filter((k) => k.pkg === del.id).length} client(s) who bought it keep their sessions on the terms they paid for.`} onDelete={() => st.deletePackage(del.id)} onClose={() => setDel(null)} />}</Dialog>
      <Dialog open={imp} onOpenChange={setImp}>{imp && <CsvDialog title="Upload packages (CSV)" description="One row per therapy in a package. Rows with the same package_id (or the same package_name when id is blank) form one package."
        help={<><div><b className="text-foreground">Columns:</b> {PACKAGE_COLUMNS.join(", ")}</div><div><b className="text-foreground">Set therapies:</b> one row per therapy · therapy = its code (e.g. SD, KTV) or id · sessions = 1–100 · package_price the same on every row. Example: "Back care, 8 sessions" with KTV 6 + SD 2 → 8 sessions.</div><div><b className="text-foreground">Flexible plan:</b> one row, therapy blank, sessions = total (e.g. PLAN 2, Spine Correction Program, 999, …, sessions 7).</div><div><b className="text-foreground">Details</b> on the package's first row: package_code (e.g. PLAN 1), duration (e.g. 4 weeks), validity_months (1–60, blank = no expiry), inclusions separated by ";". Upload new therapies first.</div><div><b className="text-foreground">Updating a package</b> replaces its therapy list with the rows in the file and applies to new sales only.</div></>}
        template={tpl} current={() => saveBlob(csvBlob(packageExportCsv(S.PKG, S.SVC)), `packages-${stamp()}.csv`)} read={(t) => readPackageCsv(t, S.PKG, S.SVC)} onImport={st.importPackages} onClose={() => setImp(false)} />}</Dialog>
    </Card>)
}

/** Record a package session: pick which of the package's therapies was done. */
export function SessionDialog({ k, state, patient, onClose }) {
  const st = useStore(), open = state.items.filter((i) => i.left > 0)
  const [svc, setSvc] = useState(open[0]?.svc ?? "")
  return (
    <DialogContent title="Record package session" description={`${patient?.name ?? ""} · ${state.g.name.en} · ${state.left} of ${state.g.sessions} sessions left`}>
      <div className="grid gap-2">{state.items.map((i) => { const t = tName(st.S.SVC, i.svc); return (
        <label key={i.svc} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm", svc === i.svc && "border-herb bg-herb-soft", i.left <= 0 && "cursor-not-allowed opacity-50")}>
          <input type="radio" name="svc" className="accent-[#1f7a3f]" disabled={i.left <= 0} checked={svc === i.svc} onChange={() => setSvc(i.svc)} />
          <span className="flex-1"><b>{t?.name.en ?? i.svc}</b>{t?.mins && <span className="ml-2 text-xs text-muted-foreground"><Clock className="inline size-3" /> {t.mins} min</span>}</span><Badge variant={i.left ? "info" : "muted"}>{i.used} / {i.n} used</Badge></label>) })}</div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="herb" disabled={!svc} onClick={async () => { if (await st.useSession(k.id, svc)) onClose() }}><CheckCircle2 />Record session</Button></div>
    </DialogContent>)
}

/** <option>s for booking a prepaid package session, one per therapy with sessions left */
export function PackageSessionOptions({ pid }) {
  const { S } = useStore()
  const open = S.PK.filter((k) => k.pid === pid).map((k) => ({ k, s: packageState(k) })).filter(({ s }) => s.left > 0 && !s.expired)
  if (!open.length) return null
  const tag = (s) => (s.canUse ? "" : " · balance due")
  return <optgroup label="Prepaid package session">{open.flatMap(({ k, s }) => s.items.length
    ? s.items.filter((i) => i.left > 0).map((i) => <option key={k.id + i.svc} value={`session:${i.svc}`}>{therapyName(i.svc)} · {s.g.name.en} · {i.left} left{tag(s)}</option>)
    : [<option key={k.id} value="session">{s.g.name.en} · {s.left} left{tag(s)}</option>])}</optgroup>
}
