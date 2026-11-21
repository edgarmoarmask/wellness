// Pharmacy & stock: product list with add / edit / delete, CSV bulk upload, template and stock export.
import { useMemo, useRef, useState } from "react"
import { PackagePlus, Plus, Pencil, Trash2, Upload, Download, FileSpreadsheet, Search, AlertTriangle, CheckCircle2, Info } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input, NativeSelect, Label } from "@/components/ui/input"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Table, THead, TR, TH, TD } from "@/components/ui/table"
import { useLang } from "@/lib/i18n"
import { useStore } from "@/lib/store"
import { rm, num, cn } from "@/lib/utils"
import { FORMS } from "@data/inventory.js"
import { ageDays } from "@data/util.js"
import { reorderQty } from "@/lib/rules"
import { acc } from "@/lib/ledger"
import { checkProduct, productPostings, readProductCsv, templateCsv, exportCsv, USES, BASES, CSV_COLUMNS } from "@/lib/products"
import { saveBlob } from "./Accounting"

const csvBlob = (text) => new Blob([text], { type: "text/csv;charset=utf-8" })
const EMPTY = { name: "", form: "thailam", unit: "bottle", stock: "0", reorder: "10", price: "", cost: "", batch: "", exp: "", base: "", sugar: false, preg: false, use: "both" }
const toForm = (i) => ({ name: i.name, form: i.form, unit: i.unit, stock: String(i.stock), reorder: String(i.reorder), price: String(i.price), cost: String(i.cost ?? 0), batch: i.batch ?? "", exp: i.exp ? String(i.exp).slice(0, 10) : "", base: i.base ?? "", sugar: !!i.sugar, preg: (i.contra ?? []).includes("pregnancy"), use: i.use ?? "both" })
const fromForm = (f, before) => ({ ...f, contra: [...(before?.contra ?? []).filter((c) => c !== "pregnancy"), ...(f.preg ? ["pregnancy"] : [])] })

/** journal lines a change will post, shown before saving */
function Postings({ list }) {
  if (!list.length) return null
  return <div className="grid gap-1 rounded-xl border border-dashed bg-muted/40 p-3 text-xs"><b className="flex items-center gap-1.5"><Info className="size-3.5" />Goes to the books</b>
    {list.map((e, i) => <div key={i} className="flex gap-2"><span className="flex-1">{e.d}<span className="block text-muted-foreground">Dr {e.dr} {acc(e.dr)?.name} · Cr {e.cr} {acc(e.cr)?.name}</span></span><b>{rm(e.amt)}</b></div>)}</div>
}

function ProductDialog({ item, onClose }) {
  const st = useStore(), editing = item && item !== "new", before = editing ? item : null
  const [f, setF] = useState(() => (editing ? toForm(item) : EMPTY)), [err, setErr] = useState("")
  const set = (p) => { setF((o) => ({ ...o, ...p })); setErr("") }
  const chk = checkProduct(fromForm(f, before), { id: before?.id, all: st.S.INV })
  const preview = chk.d ? productPostings(before, chk.d) : []
  const save = async (e) => { e.preventDefault(); const r = await st.saveProduct(fromForm(f, before), before?.id); if (r?.error) return setErr(r.error); onClose() }
  return (
    <DialogContent className="max-w-2xl" title={editing ? `Edit · ${item.name}` : "Add product"} description={editing ? `Product id ${item.id}` : "Medicine, oil or retail item. Opening stock is added to the stock value."}>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <Label className="sm:col-span-2">Product name *<Input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Pinda Thailam 200ml" autoFocus /></Label>
        <Label>Form *<NativeSelect value={f.form} onChange={(e) => set({ form: e.target.value })}>{Object.entries(FORMS).map(([k, v]) => <option key={k} value={k}>{v.en}</option>)}</NativeSelect></Label>
        <Label>Unit *<Input value={f.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="bottle, jar, pack" list="units" /><datalist id="units">{["bottle", "jar", "pack", "box", "tube", "litre"].map((u) => <option key={u} value={u} />)}</datalist></Label>
        <Label>{editing ? "Stock on hand" : "Opening stock"}<Input inputMode="numeric" value={f.stock} onChange={(e) => set({ stock: e.target.value })} />
          <span className="text-xs font-normal text-muted-foreground">{editing ? "Change only after a physical count. New deliveries: use Reorder / receive." : "Quantity you already have on the shelf."}</span></Label>
        <Label>Reorder when stock falls below<Input inputMode="numeric" value={f.reorder} onChange={(e) => set({ reorder: e.target.value })} /></Label>
        <Label>Selling price (RM) *<Input inputMode="decimal" value={f.price} onChange={(e) => set({ price: e.target.value })} /></Label>
        <Label>Cost price per unit (RM)<Input inputMode="decimal" value={f.cost} onChange={(e) => set({ cost: e.target.value })} /><span className="text-xs font-normal text-muted-foreground">Used for cost of medicines sold and stock value.</span></Label>
        <Label>Batch no.<Input value={f.batch} onChange={(e) => set({ batch: e.target.value })} /></Label>
        <Label>Expiry date<Input type="date" value={f.exp} onChange={(e) => set({ exp: e.target.value })} /></Label>
        <Label>Base oil<NativeSelect value={f.base} onChange={(e) => set({ base: e.target.value })}>{Object.entries(BASES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect><span className="text-xs font-normal text-muted-foreground">Sesame oil is blocked for patients with a sesame allergy.</span></Label>
        <Label>Use for<NativeSelect value={f.use} onChange={(e) => set({ use: e.target.value })}>{Object.entries(USES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></Label>
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm"><input type="checkbox" className="size-4 accent-[#1f7a3f]" checked={f.sugar} onChange={(e) => set({ sugar: e.target.checked })} />Contains sugar (warns for diabetes)</label>
        <label className="flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm"><input type="checkbox" className="size-4 accent-[#1f7a3f]" checked={f.preg} onChange={(e) => set({ preg: e.target.checked })} />Avoid in pregnancy (blocks)</label>
        <div className="sm:col-span-2"><Postings list={preview} /></div>
        {(err || (chk.error && f.name)) && <p className="text-sm font-semibold text-destructive sm:col-span-2" role="alert">{err || chk.error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={!!chk.error}>{editing ? "Save changes" : "Add product"}</Button></div>
      </form>
    </DialogContent>)
}

function DeleteDialog({ item, onClose }) {
  const st = useStore(), [err, setErr] = useState(""), list = productPostings(item, null)
  return (
    <DialogContent title={`Delete ${item.name}?`} description="It disappears from stock and can no longer be prescribed. Past prescriptions, invoices and reports keep it.">
      {item.stock > 0 && <p className="flex gap-2 rounded-xl bg-[#fdf1dc] p-3 text-sm text-warn"><AlertTriangle className="size-4 shrink-0" />{num(item.stock)} {item.unit} still in stock will be written off.</p>}
      <Postings list={list} />
      {err && <p className="text-sm font-semibold text-destructive" role="alert">{err}</p>}
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button variant="destructive" onClick={async () => { const e = await st.deleteProduct(item.id); if (e) return setErr(e); onClose() }}><Trash2 />Delete product</Button></div>
    </DialogContent>)
}

function ImportDialog({ onClose }) {
  const st = useStore(), inp = useRef(null)
  const [file, setFile] = useState(""), [res, setRes] = useState(null), [busy, setBusy] = useState(false), [serverErr, setServerErr] = useState(null)
  const pick = async (e) => {
    const fl = e.target.files?.[0]; if (!fl) return
    if (fl.size > 2_000_000) { setRes({ error: "File is larger than 2 MB." }); return }
    setFile(fl.name); setServerErr(null); setRes(readProductCsv(await fl.text(), st.S.INV)); e.target.value = ""
  }
  const rows = res?.rows ?? [], ok = rows.filter((r) => !r.error && r.action !== "same"), bad = rows.filter((r) => r.error)
  const count = (a) => rows.filter((r) => !r.error && r.action === a).length
  const go = async () => { setBusy(true); const r = await st.importProducts(ok); setBusy(false); if (r?.error) return setServerErr(r.errors?.length ? r.errors : [{ row: "-", message: r.error }]); onClose() }
  return (
    <DialogContent className="max-w-3xl" title="Bulk upload products (CSV)" description="Add new products and update existing ones in one go. Rows are matched by id, or by product name when id is blank.">
      <div className="grid gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
        <div><b className="text-foreground">Columns:</b> {CSV_COLUMNS.join(", ")}</div>
        <div><b className="text-foreground">Values:</b> form = {Object.keys(FORMS).join(" / ")} · base_oil = sesame / coconut / other / blank · contains_sugar, avoid_in_pregnancy = yes / no · use_for = dispense / therapy / both · expiry = 2027-03-31 or 31/03/2027</div>
        <div><b className="text-foreground">Stock:</b> new product = opening stock. Existing product = your counted stock; the difference is recorded as a stock adjustment.</div>
        <div className="flex flex-wrap gap-2 pt-1"><Button size="sm" variant="outline" type="button" onClick={() => saveBlob(csvBlob(templateCsv()), "product-upload-template.csv")}><FileSpreadsheet />Download template</Button><Button size="sm" variant="outline" type="button" onClick={() => saveBlob(csvBlob(exportCsv(st.S.INV)), `stock-${new Date().toISOString().slice(0, 10)}.csv`)}><Download />Current stock as CSV (edit &amp; re-upload)</Button></div>
      </div>
      <input ref={inp} type="file" accept=".csv,text/csv" className="hidden" onChange={pick} />
      <button type="button" onClick={() => inp.current?.click()} className="grid cursor-pointer justify-items-center gap-1 rounded-2xl border-2 border-dashed p-6 text-sm font-semibold hover:border-primary hover:text-primary"><Upload className="size-6" />{file ? `${file} · choose another file` : "Choose CSV file"}<span className="text-xs font-normal text-muted-foreground">Saved from Excel or Google Sheets as CSV · max 2,000 rows</span></button>
      {res?.error && <p className="text-sm font-semibold text-destructive" role="alert">{res.error}</p>}
      {rows.length > 0 && <>
        <div className="flex flex-wrap gap-2 text-xs"><Badge variant="ok">{count("add")} new</Badge><Badge variant="info">{count("update")} updated</Badge><Badge variant="muted">{count("same")} no change</Badge>{bad.length > 0 && <Badge variant="danger">{bad.length} with errors (skipped)</Badge>}</div>
        <div className="max-h-72 overflow-auto rounded-xl border"><Table><THead><tr><TH>Row</TH><TH>Product</TH><TH>Result</TH><TH className="text-right">Stock</TH><TH className="text-right">Price</TH></tr></THead>
          <tbody>{[...rows].sort((a, b) => (b.error ? 1 : 0) - (a.error ? 1 : 0) || (a.action === "same") - (b.action === "same") || a.line - b.line).map((r) => <TR key={r.line} className={r.error ? "bg-[#fee2e2]/40" : ""}><TD>{r.line}</TD><TD><b>{r.name || "—"}</b>{r.id && <div className="text-xs text-muted-foreground">{r.id}</div>}</TD>
            <TD>{r.error ? <span className="text-xs font-semibold text-destructive">{r.error}</span> : <Badge variant={r.action === "add" ? "ok" : r.action === "update" ? "info" : "muted"}>{{ add: "New", update: "Update", same: "No change" }[r.action]}</Badge>}</TD>
            <TD className="text-right">{r.d ? <>{r.before && r.before.stock !== r.d.stock ? <span className="text-muted-foreground line-through">{r.before.stock}</span> : null} {r.d.stock}</> : ""}</TD><TD className="text-right">{r.d ? rm(r.d.price) : ""}</TD></TR>)}</tbody></Table></div>
      </>}
      {serverErr && <div className="grid gap-1 text-sm text-destructive" role="alert">{serverErr.map((e, i) => <div key={i}>Row {e.row}: {e.message}</div>)}</div>}
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!ok.length || busy} onClick={go}><CheckCircle2 />{busy ? "Importing…" : `Import ${ok.length} product${ok.length === 1 ? "" : "s"}`}</Button></div>
    </DialogContent>)
}

export function InventoryCard() {
  const { day } = useLang(), st = useStore(), { S } = st
  const [q, setQ] = useState(""), [form, setForm] = useState(""), [show, setShow] = useState("all")
  const [edit, setEdit] = useState(null), [del, setDel] = useState(null), [imp, setImp] = useState(false)
  const active = S.INV.filter((i) => !i.archived)
  const list = useMemo(() => active.filter((i) => (!q || `${i.name} ${i.batch ?? ""} ${i.id}`.toLowerCase().includes(q.toLowerCase())) && (!form || i.form === form) && (show === "all" || (show === "low" ? i.stock < i.reorder : i.exp && -ageDays(i.exp) < 60))), [active, q, form, show])
  const value = active.reduce((a, i) => a + i.stock * (i.cost || 0), 0)
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center gap-2"><CardTitle className="mr-auto">Products &amp; stock <span className="text-sm font-normal text-muted-foreground">· {active.length} products · stock value {rm(value)} at cost</span></CardTitle>
        <Button size="sm" variant="outline" onClick={() => saveBlob(csvBlob(templateCsv()), "product-upload-template.csv")}><FileSpreadsheet />Download template</Button>
        <Button size="sm" variant="outline" onClick={() => setImp(true)}><Upload />Bulk upload CSV</Button>
        <Button size="sm" onClick={() => setEdit("new")}><Plus />Add product</Button></CardHeader>
      <CardContent className="grid gap-3 p-0">
        <div className="flex flex-wrap gap-2 px-6"><div className="relative min-w-56 flex-1"><Search className="absolute top-3 left-3 size-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search name, batch or id" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <NativeSelect className="w-52" value={form} onChange={(e) => setForm(e.target.value)}><option value="">All forms</option>{Object.entries(FORMS).map(([k, v]) => <option key={k} value={k}>{v.en}</option>)}</NativeSelect>
          <NativeSelect className="w-44" value={show} onChange={(e) => setShow(e.target.value)}><option value="all">All stock</option><option value="low">Below reorder level</option><option value="exp">Expiring in 60 days</option></NativeSelect>
          <Button variant="ghost" onClick={() => saveBlob(csvBlob(exportCsv(S.INV)), `stock-${new Date().toISOString().slice(0, 10)}.csv`)}><Download />Export CSV</Button></div>
        <Table>
          <THead><tr><TH>Item</TH><TH className="text-right">Stock</TH><TH className="text-right">Reorder at</TH><TH>Expiry</TH><TH className="text-right">Price</TH><TH className="text-right">Cost</TH><TH>Status</TH><TH /></tr></THead>
          <tbody>{list.length === 0 ? <TR><TD colSpan={8} className="py-8 text-center text-sm text-muted-foreground">{active.length ? "No products match." : "No products yet. Add one or bulk upload a CSV."}</TD></TR> : list.map((i) => { const low = i.stock < i.reorder, ex = i.exp ? -ageDays(i.exp) : null; return (
            <TR key={i.id}><TD><b>{i.name}</b><div className="text-xs text-muted-foreground">{FORMS[i.form]?.en ?? i.form} · {i.id}{i.batch ? ` · batch ${i.batch}` : ""}{i.base === "sesame" ? " · sesame base" : ""}{i.sugar ? " · sugar" : ""}{(i.contra ?? []).includes("pregnancy") ? " · not in pregnancy" : ""}</div></TD>
              <TD className="text-right">{num(i.stock)} {i.unit}</TD><TD className="text-right">{num(i.reorder)}</TD>
              <TD>{i.exp ? <>{day(i.exp)} {new Date(i.exp).getFullYear()} {ex < 0 ? <Badge variant="danger">Expired</Badge> : ex < 60 && <Badge variant="warn">{ex} days</Badge>}</> : <span className="text-muted-foreground">—</span>}</TD>
              <TD className="text-right">{rm(i.price)}</TD><TD className="text-right text-muted-foreground">{rm(i.cost || 0)}</TD>
              <TD>{low ? <Badge variant="danger">Below reorder level</Badge> : <Badge variant="ok">OK</Badge>}</TD>
              <TD className="text-right"><div className="flex justify-end gap-1">{low && <Button size="sm" variant="outline" onClick={() => st.reorder(i.id)}><PackagePlus />Reorder {reorderQty(i)}</Button>}
                <Button size="sm" variant="ghost" aria-label={`Edit ${i.name}`} onClick={() => setEdit(i)}><Pencil /></Button>
                <Button size="sm" variant="ghost" aria-label={`Delete ${i.name}`} className="text-destructive" onClick={() => setDel(i)}><Trash2 /></Button></div></TD></TR>) })}</tbody></Table>
      </CardContent>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>{edit && <ProductDialog key={edit === "new" ? "new" : edit.id} item={edit} onClose={() => setEdit(null)} />}</Dialog>
      <Dialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>{del && <DeleteDialog item={del} onClose={() => setDel(null)} />}</Dialog>
      <Dialog open={imp} onOpenChange={setImp}>{imp && <ImportDialog onClose={() => setImp(false)} />}</Dialog>
    </Card>)
}
