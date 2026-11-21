// Accounts, AI assistant.
import { useState } from "react"
import { CheckCircle2, Landmark, Sparkles, Wallet, TrendingDown, FileClock, Gift, AlertTriangle, Sun, Pill, Users } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input, NativeSelect, Label } from "@/components/ui/input"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Table, THead, TR, TH, TD } from "@/components/ui/table"
import { PageHead, Status, Kpi, HBars, IconChip } from "@/components/kit"
import { useLang } from "@/lib/i18n"
import { useStore } from "@/lib/store"
import { rm, rm0, cn } from "@/lib/utils"
import { PAYMENT_POLICY } from "@data/clinic.js"
import { ageDays } from "@data/util.js"
import { pkgOf, packageState } from "@/lib/rules"

export function Assistant({ go }) {
  const { S } = useStore()
  const today = new Date().toISOString().slice(0, 10)
  const waiting = S.Q.filter((v) => v.date === today && v.status === "waiting").length, booked = S.Q.filter((v) => v.date === today && v.status === "booked").length, low = S.INV.filter((i) => !i.archived && i.stock < i.reorder)
  const due = S.PK.map((k) => ({ k, ...packageState(k) })).filter((s) => s.balance > 0).sort((a, b) => b.overdue - a.overdue), renew = S.PK.filter((k) => packageState(k).left === 1)
  const flagged = S.P.filter((p) => p.allergy || (p.flags || []).length)
  const brief = [[Sun, `${waiting} patient(s) waiting and ${booked} more booked today.`],
    [Pill, low.length ? `${low.length} item(s) below reorder level, including ${low.slice(0, 2).map((i) => i.name).join(" and ")}.` : "All stock is above reorder level."],
    [Wallet, `${due.length} package client(s) have a balance; ${due.filter((d) => d.overdue).length} are past ${PAYMENT_POLICY.balanceDueDays} days.`],
    [Gift, `${renew.length} package client(s) have one session left. Suggest a renewal at their next visit.`]]
  return (
    <div className="grid gap-5">
      <PageHead icon={Sparkles} tone="violet" title="AI assistant" sub="Optional AI features, set up with the centre. Vaidyas keep clinical responsibility." />
      <Card><CardHeader><CardTitle><Sun className="size-4 text-gold" />Morning brief</CardTitle></CardHeader><CardContent className="grid gap-2">{brief.map(([I, b], i) => <div key={i} className="flex items-start gap-3 rounded-xl bg-muted p-3 text-sm"><IconChip icon={I} tone={["gold", "amber", "cyan", "pink"][i]} size="sm" />{b}</div>)}
        <p className="text-xs text-muted-foreground">Can be sent to the centre manager on WhatsApp every morning.</p></CardContent></Card>
      <Card><CardHeader><CardTitle><Wallet className="size-4 text-gold" />Package balance reminders</CardTitle></CardHeader><CardContent className="grid gap-2">
        {due.length ? due.map(({ k, g, balance, overdue, canUse }) => { const p = S.P.find((z) => z.id === k.pid); return <div key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm"><span><b>{p?.name}</b> · {g.name.en} · balance <b>{rm(balance)}</b> · {p?.phone}</span><span className="flex flex-wrap gap-1.5">{overdue && <Badge variant="danger">Overdue</Badge>}{!canUse && <Badge variant="warn">Next session locked</Badge>}</span></div> })
          : <p className="text-sm text-muted-foreground">No balances outstanding.</p>}
        <p className="text-xs text-muted-foreground">Staff send reminders themselves; nothing is sent automatically.</p></CardContent></Card>
      <Card><CardHeader><CardTitle><AlertTriangle className="size-4 text-destructive" />Prescription safety</CardTitle></CardHeader><CardContent className="grid gap-3">
        <p className="text-sm">When a Vaidya adds a medicine or oil, the system checks the patient's recorded allergies and conditions: sesame-based thailams are blocked for a sesame allergy, pregnancy contraindications are blocked, and sugar-based lehyams raise a warning for diabetes. Record allergies and conditions when registering each patient.</p>
        <p className="text-sm"><b>{flagged.length}</b> registered patient(s) have an allergy or condition on file.</p>
        <Button variant="outline" className="w-fit" onClick={() => go("patients")}><Users />Open patients</Button></CardContent></Card>
    </div>)
}
