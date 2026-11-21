// Printable bill (A4), laid out like the clinic's paper bill: header band, BILL, patient / age / date,
// description + amount table, total, amount in words, authorised signature (signed and stamped by hand), specialities footer.
import logo from "@/assets/dhanwanthari-logo.jpg"
import wordmark from "@/assets/dhanwanthari-wordmark.png"

export const BILL_HEADER = {
  address: ["No.241, 1st Floor, Jalan Tun Sambanthan,", "Brickfields, Kualalumpur-50470, Malaysia."],
  email: "ayurvedabrickfieldskl@gmail.com",
  phone: "+60 11 3342 3455",
  specialities: "Spinal Disorders, Joint Disorders, Neck, Upper and Lower, Back Pain Management, Stroke Rehabilitation",
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]
function words999(n) {
  const h = Math.floor(n / 100), r = n % 100, out = []
  if (h) out.push(ONES[h] + " Hundred")
  if (r) out.push(r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? "-" + ONES[r % 10] : ""))
  return out.join(" ")
}
function words(n) {
  if (n === 0) return "Zero"
  const parts = [], scales = [[1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"], [1, ""]]
  for (const [v, name] of scales) { const q = Math.floor(n / v) % 1000; if (q) parts.push(words999(q) + (name ? " " + name : "")) }
  return parts.join(" ")
}
/** 80 → "Eighty Only"; 1250.5 → "One Thousand Two Hundred Fifty and Fifty Sen Only" */
export function amountInWords(amount) {
  const cents = Math.round(Number(amount) * 100), rm = Math.floor(cents / 100), sen = cents % 100
  if (rm === 0 && sen) return `${words(sen)} Sen Only`
  return `${words(rm)}${sen ? ` and ${words(sen)} Sen` : ""} Only`
}

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])
const money = (n) => Number(n || 0).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dmy = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split("-"); return `${d}/${m}/${y}` }
const abs = (u) => new URL(u, window.location.href).href

const CSS = `
@page{size:A4;margin:0}
*{box-sizing:border-box}html,body{margin:0;background:#fff}
body{font-family:Arial,Helvetica,sans-serif;color:#2b2f2c;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;min-height:297mm;padding:9mm 10mm 12mm;display:flex;flex-direction:column;margin:0 auto}
.band{display:flex;align-items:center;justify-content:space-between;gap:8mm;padding:7mm 8mm;border-radius:2mm;background:linear-gradient(90deg,#f2f1d6 0%,#f8f7e6 55%,#fbfaef 100%)}
.brand{display:flex;align-items:center;gap:4mm}.brand .logo{width:24mm;height:24mm;object-fit:contain;border-radius:50%}.brand .wm{height:17mm}
.contact{font-size:9.5pt;line-height:1.55;color:#55635a}.contact div{display:flex;gap:2mm;align-items:flex-start}.contact svg{flex:none;margin-top:1mm}
h1{text-align:center;font-size:20pt;letter-spacing:.5pt;margin:14mm 0 10mm;color:#3a3f3c}
.meta{display:grid;grid-template-columns:28mm 1fr 22mm 40mm;row-gap:4mm;padding:0 8mm;font-size:11pt}.meta .k{font-weight:700;color:#3a3f3c}.meta .r{text-align:right}
table{width:calc(100% - 16mm);margin:12mm 8mm 0;border-collapse:collapse;font-size:11pt}
th{background:#f1f0e4;text-align:left;padding:4mm 4mm;font-size:10.5pt;letter-spacing:.3pt;color:#3a3f3c}th:last-child,td:last-child{text-align:right;white-space:nowrap}
td{padding:4.5mm 4mm;border-bottom:.3mm solid #e2e4dd;vertical-align:top}td small{display:block;color:#7b827d;font-size:9pt;margin-top:1mm}
tr.sub td{border:0;padding:2mm 4mm;color:#59605b}tr.total td{border:0;padding:6mm 4mm 2mm;font-size:13pt;font-weight:700;color:#3a3f3c}
.words{padding:2mm 8mm 0;font-style:italic;font-size:10.5pt;color:#4b514d}
.pay{padding:3mm 8mm 0;font-size:9.5pt;color:#6b726d}
.sign{margin:14mm 8mm 0 auto;width:75mm;text-align:right}.sign .stamp{height:24mm}.sign .line{border-top:.3mm solid #3a3f3c;margin-bottom:2mm}.sign .seal{height:34mm}
.sign span{font-size:10.5pt;color:#3a3f3c}
.foot{margin-top:auto;border-top:.3mm solid #c9ccc4;padding:3mm 2mm 0;font-size:9pt;color:#6b726d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.foot b{color:#5d9a5a;font-weight:600}
@media screen{body{background:#eef0ec}.page{box-shadow:0 2px 12px rgba(0,0,0,.12);margin:16px auto;background:#fff}}
`
const pin = `<svg width="9" height="11" viewBox="0 0 24 30"><path fill="#e05252" d="M12 0C5.4 0 0 5.2 0 11.7 0 20.4 12 30 12 30s12-9.6 12-18.3C24 5.2 18.6 0 12 0zm0 16a4.3 4.3 0 110-8.6 4.3 4.3 0 010 8.6z"/></svg>`
const mail = `<svg width="10" height="10" viewBox="0 0 24 24"><path fill="#e05252" d="M2 4h20v16H2z"/><path fill="#fff" d="M2 4l10 8 10-8v2l-10 8L2 6z"/></svg>`
const wa = `<svg width="10" height="10" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#3fae4f"/><path fill="#fff" d="M8.5 6.5c-.6 0-1.6.6-1.6 2 0 1.5 1.1 3.3 2.9 5s3.6 2.6 4.9 2.6c1.3 0 2-.9 2-1.5 0-.3-.1-.5-.4-.7l-1.6-.8c-.3-.1-.6 0-.8.2l-.6.8c-1.4-.5-2.9-1.9-3.4-3.3l.7-.6c.2-.2.3-.5.2-.8l-.7-1.6c-.1-.3-.4-.4-.7-.4z"/></svg>`

/**
 * bill = { no, date (YYYY-MM-DD), patient, age, lines: [{ d, note?, amt }], subtotal?, sst?, sstRate?, sstReg?, total, paid?, balance?, payment? }
 * Returns a complete HTML document (A4).
 */
const header = () => `<div class="band"><div class="brand"><img class="logo" src="${abs(logo)}" alt=""><img class="wm" src="${abs(wordmark)}" alt="Dhanwanthari Vilāsam · Ayurvedic &amp; Traditional Spine Treatment Centre"></div>
<div class="contact"><div>${pin}<span>${BILL_HEADER.address.map(esc).join("<br>")}</span></div><div>${mail}<span>${esc(BILL_HEADER.email)}</span></div><div>${wa}<span>${esc(BILL_HEADER.phone)}</span></div></div></div>`
const footer = () => `<div class="foot"><b>We Specialize in:</b> ${esc(BILL_HEADER.specialities)}</div>`

export function billHtml(b) {
  const rows = b.lines.map((l) => `<tr><td>${esc(l.d)}${l.note ? `<small>${esc(l.note)}</small>` : ""}</td><td>${money(l.amt)}</td></tr>`).join("")
  const tax = b.sst > 0 ? `<tr class="sub"><td>Subtotal</td><td>${money(b.subtotal)}</td></tr><tr class="sub"><td>Service tax (SST) ${esc(b.sstRate)}%${b.sstReg ? ` · SST reg. ${esc(b.sstReg)}` : ""}</td><td>${money(b.sst)}</td></tr>` : ""
  const after = b.balance !== undefined ? `<tr class="sub"><td>Paid to date</td><td>${money(b.paid)}</td></tr><tr class="sub"><td><b>Balance due</b></td><td><b>${money(b.balance)}</b></td></tr>` : ""
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bill ${esc(b.no)} · ${esc(b.patient)}</title><style>${CSS}</style></head><body><div class="page">
${header()}
<h1>BILL</h1>
<div class="meta"><span class="k">Patient Name:</span><span>${esc(b.patient)}</span><span class="k">Date:</span><span class="r">${dmy(b.date)}</span>
<span class="k">Age:</span><span>${b.age === null || b.age === undefined ? "" : `${b.age} years`}</span><span class="k">Bill No:</span><span class="r">${esc(b.no)}</span></div>
<table><thead><tr><th>DESCRIPTION</th><th>AMOUNT (RM)</th></tr></thead><tbody>${rows}${tax}<tr class="total"><td>TOTAL</td><td>RM ${money(b.total)}</td></tr>${after}</tbody></table>
<div class="words">Ringgit Malaysia: ${esc(amountInWords(b.total))}</div>
${b.payment ? `<div class="pay">${esc(b.payment)}</div>` : ""}
<div class="sign"><div class="stamp"></div><div class="line"></div><span>Authorised Signature</span><div class="seal"></div></div>
${footer()}
</div></body></html>`
}

// A5 receipt: same header and footer, scaled for half a sheet
const RECEIPT_CSS = CSS.replace("@page{size:A4;margin:0}", "@page{size:A5;margin:0}") + `
.page{width:148mm;min-height:210mm;padding:6mm 7mm 8mm}
.band{padding:4mm 5mm;gap:4mm}.brand{gap:2.5mm}.brand .logo{width:15mm;height:15mm}.brand .wm{height:10.5mm}.contact{font-size:6.6pt;line-height:1.5}
h1{font-size:14pt;margin:7mm 0 5mm;letter-spacing:1pt}
.meta{grid-template-columns:27mm 1fr;row-gap:2mm;padding:0 3mm;font-size:8.8pt}
table{width:calc(100% - 6mm);margin:5mm 3mm 0;font-size:8.8pt}th{padding:2.2mm 3mm;font-size:8pt}td{padding:2.2mm 3mm}td small{font-size:7pt}
tr.sub td{padding:1.2mm 3mm}tr.total td{padding:3.5mm 3mm 1.5mm;font-size:10.5pt}
.words{padding:1.5mm 3mm 0;font-size:8.5pt}.paid{margin:4mm 3mm 0;display:inline-block;align-self:flex-start;border:.5mm solid #3f8f4a;color:#3f8f4a;border-radius:1.5mm;padding:1.2mm 3mm;font-weight:700;font-size:9pt;letter-spacing:.6pt}
.recv{padding:2mm 3mm 0;font-size:8.3pt;color:#5d655f}
.sign{margin:8mm 3mm 0 auto;width:55mm}.sign .stamp{height:14mm}.sign .seal{height:18mm}.sign span{font-size:8.5pt}
.foot{font-size:6.8pt;padding:2mm 1mm 0}
@media screen{.page{margin:12px auto}}`

/**
 * receipt = { no, date, time, billNo, patient, method, lines: [{ d, note?, amt }], subtotal?, sst?, sstRate?, sstReg?, total, receivedBy? }
 * Official receipt for money received (A5).
 */
export function receiptHtml(r) {
  const rows = r.lines.map((l) => `<tr><td>${esc(l.d)}${l.note ? `<small>${esc(l.note)}</small>` : ""}</td><td>${money(l.amt)}</td></tr>`).join("")
  const tax = r.sst > 0 ? `<tr class="sub"><td>Subtotal</td><td>${money(r.subtotal)}</td></tr><tr class="sub"><td>Service tax (SST) ${esc(r.sstRate)}%${r.sstReg ? ` · SST reg. ${esc(r.sstReg)}` : ""}</td><td>${money(r.sst)}</td></tr>` : ""
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt ${esc(r.no)} · ${esc(r.patient)}</title><style>${RECEIPT_CSS}</style></head><body><div class="page">
${header()}
<h1>OFFICIAL RECEIPT</h1>
<div class="meta"><span class="k">Receipt No:</span><span>${esc(r.no)}</span><span class="k">Date &amp; time:</span><span>${dmy(r.date)}${r.time ? `, ${esc(r.time)}` : ""}</span>
<span class="k">Received from:</span><span>${esc(r.patient)}</span>${r.billNo ? `<span class="k">For bill:</span><span>${esc(r.billNo)}</span>` : ""}<span class="k">Payment method:</span><span>${esc(r.method)}</span></div>
<table><thead><tr><th>DESCRIPTION</th><th>AMOUNT (RM)</th></tr></thead><tbody>${rows}${tax}<tr class="total"><td>AMOUNT RECEIVED</td><td>RM ${money(r.total)}</td></tr></tbody></table>
<div class="words">Ringgit Malaysia: ${esc(amountInWords(r.total))}</div>
<div class="paid">PAID · THANK YOU</div>
${r.receivedBy ? `<div class="recv">Received by: ${esc(r.receivedBy)}</div>` : ""}
<div class="sign"><div class="stamp"></div><div class="line"></div><span>Authorised Signature</span><div class="seal"></div></div>
${footer()}
</div></body></html>`
}

/** Prints through a hidden frame (no pop-up). Browsers offer "Save as PDF" in the same dialog. */
export function printBill(html) {
  const f = document.createElement("iframe")
  Object.assign(f.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" })
  document.body.appendChild(f)
  const doc = f.contentDocument; doc.open(); doc.write(html); doc.close()
  const go = () => { try { f.contentWindow.focus(); f.contentWindow.print() } finally { setTimeout(() => f.remove(), 60_000) } }
  const imgs = [...doc.images]; Promise.all(imgs.map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r })))).then(() => setTimeout(go, 50))
}
