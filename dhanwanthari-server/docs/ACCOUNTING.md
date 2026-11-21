# Accounting module — where things show, what they're called, how they post

Shared rules: `app/ledger.py` (API) = `dvc/src/lib/ledger.js` (web app). Same file — keep them identical.

## 1. Where it shows in the app (sidebar → Accounting)

| Menu item | What staff see | API |
|---|---|---|
| **Transactions** | Total received · Expenses · Cash profit · Pending; tabs All / Paid / Pending / Failed / Cancelled; search; **Add payment**, **Add expense**; *Update* per row (mark paid, failed, cancel/refund) | `GET /api/transactions`, `POST /api/payments`, `POST /api/expenses`, `POST /api/transactions/:id/status` |
| **Reports (P&L, balance sheet)** | Profit & Loss (Revenue → Cost of sales → Gross profit & margin → Operating expenses → Net profit & margin), Balance Sheet, Trial Balance; This month / Last month / This year / All time; Download Excel | `GET /api/reports/profit-and-loss`, `/balance-sheet`, `/trial-balance` |
| **General ledger** | Every debit/credit per account with running balance; filter by account and period; CSV / Excel | `GET /api/reports/general-ledger?account=1010` |
| **SST (service tax)** | Rules summary, settings (registered?, SST no., rate, consultation exempt, medicines taxable), RM1.5m threshold meter, SST-02 summary per 2-month period with due date; CSV / Excel | `GET/PUT /api/settings/sst`, `/api/reports/sst-02`, `/sst-threshold` |
| **Downloads for accountant** | 12 reports (CSV/Excel each) + **full pack** in one Excel; filing calendar (what to submit, to whom, when) | `GET /api/exports/accountant-pack.xlsx`, `/api/exports/<report>.csv` |
| **Chart of accounts** | Codes, names, groups, "posted by", balances; **Opening balances** (go-live) | `GET /api/accounts`, `POST /api/opening-balances` |

Other screens that feed accounting: **Billing** (invoice with tax code per line, subtotal, SST, total; Cash / Card / DuitNow QR / Bank transfer (pending)), **Wellness & packages** (sale, deposit, balance, session), **Pharmacy & stock** (dispense = cost of sales; reorder = stock on credit; add product = opening stock; stock count / cost change and delete = stock adjustment 5030), **Patients** (Citizenship field decides SST).

## 2. Chart of accounts (codes)

| Code | Name | Posted by |
|---|---|---|
| 1000 | Cash in hand | Billing — Cash |
| 1010 | Bank – current account | Bank transfers, expenses |
| 1020 | Card terminal clearing | Billing — Card |
| 1030 | DuitNow QR clearing | Billing — DuitNow QR |
| 1100 | Accounts receivable – patients | Pending payments (bank transfer not yet received) |
| 1200 | Inventory – medicines & oils | Stock received (+), dispensed (−) at cost |
| 1500 | Clinic equipment | Opening balance / accountant |
| 2000 | Accounts payable – suppliers | Stock on credit, unpaid bills |
| 2100 | Package deposits (unearned revenue) | Package sale, deposit, balance |
| 2200 | SST payable (service tax) | SST on invoices to non-citizens |
| 2300 | EPF / SOCSO / EIS / PCB payable | Payroll (accountant) |
| 3000 / 3100 / 3200 | Owner's capital / Retained earnings / Drawings | Opening balances / year-end / Add expense → drawings |
| 4010 | Consultation fees | Consultations |
| 4020 | Treatment & therapy revenue | Wellness packages, walk-in treatments, add-ons |
| 4030 | Package revenue (sessions delivered) | Each package session used |
| 4040 | Medicine & product sales | Medicines dispensed, retail |
| 4090 | Other income | Add payment → other income |
| 5010 | Cost of medicines sold | Pharmacy dispense (cost × qty) |
| 5020 | Therapy oils & consumables used | Accountant / future |
| 5030 | Stock adjustments & write-offs | Pharmacy & stock → edit stock count or cost, delete product, CSV upload |
| 6010–6900 | Salaries, EPF/SOCSO/EIS, Rent, Utilities, Marketing, Card fees, Repairs, Professional fees, Licences, Laundry, Other | Add expense |

## 3. Posting rules (double entry)

| Event | Debit | Credit |
|---|---|---|
| Visit paid by cash / card / DuitNow | 1000 / 1020 / 1030 | 4010 consult · 4020 treatment · 4040 medicine; SST → 2200 |
| Visit paid by bank transfer (pending) | 1100 | same income + 2200 |
| Pending confirmed paid | 1010 (or method) | 1100 |
| Pending / paid cancelled | income + 2200 | 1100 (or cash if refunded) |
| Package sale / deposit / balance | cash/bank | 2100 (+ 2200 SST if non-citizen) |
| Package session delivered | 2100 | 4030 (price ÷ sessions) |
| Medicine dispensed | 5010 | 1200 (at cost) |
| Stock received from supplier | 1200 | 2000 |
| Expense paid | 6xxx | cash/bank |
| Bill received not paid (pending) → paid | 6xxx → 2000 | 2000 → bank |
| Opening balances | asset (1000, 1010, 1200, 1500) | 3000 (liabilities the other way) |

Accrual basis: revenue when invoiced, package revenue when delivered. SST-02 uses **payments received** (service tax is due when payment is received).

## 4. Malaysian SST (service tax) as built

- Private healthcare, traditional & complementary medicine (T&CM) and allied health services: **6% to non-Malaysian citizens** from 1 July 2025; **Malaysian citizens exempt**.
- **Consultation fees** of T&CM practitioners: exempt (setting, on by default).
- Medicines dispensed to non-citizens: taxable by default (setting) — confirm with tax agent.
- **Register** with Customs when 12-month value of these services (counting exempt citizen services) exceeds **RM1.5 million**. Until registered the system charges no SST (tax code NR) and tracks the threshold.
- Registered: SST no. on invoice, tax shown separately, **SST-02 every 2 months**, due last day of the following month (nil return if no tax).
- Tax codes: `SV6` 6% · `EX-CIT` citizen exempt · `EX-CON` consultation exempt · `NR` not registered.

## 5. Reports for the accountant (Downloads)

Profit & Loss · Balance Sheet · Trial Balance · General Ledger · Journal · Sales Invoices · Cash Book (Receipts) · Expenses (Payments) · SST-02 Summary · Package Deposits · Inventory Valuation · Chart of Accounts.

Filing calendar: SST-02 (Customs, bi-monthly, if registered) · Form B (30 June, 15 July e-filing) or Form C (7 months after year end) (LHDN) · CP204 estimates (Sdn Bhd) · Form E + EA (31 March / end Feb) · EPF/SOCSO/EIS/PCB (15th monthly) · SSM annual return & financial statements (Sdn Bhd) · e-Invoice (MyInvois) only above the current exemption threshold · keep records 7 years.
Payroll (EPF, SOCSO, EIS, PCB, EA) is outside this system — record net salaries and employer contributions with Add expense (6010, 6020).
