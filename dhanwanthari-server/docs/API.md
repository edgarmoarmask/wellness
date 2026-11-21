# Clinic server API

Base `/api`. All routes except `/health`, `/auth/*` need `Authorization: Bearer <token>`.
Errors: `{"error": code, "message": text}`; form errors add `issues: [{path, message}]` (400). CSV import errors add `errors: [{row, message}]`.
Interactive docs on the running server: `/api/docs`.

| Method | Path | Summary |
|---|---|---|
| `GET` | `/api/accounts` | Accounts |
| `GET` | `/api/attendance/today` | Today |
| `POST` | `/api/attendance/clock-in` | Clock In |
| `POST` | `/api/attendance/clock-out` | Clock Out |
| `GET` | `/api/attendance` | Admin: everyone (or one person). Others: only themselves. |
| `POST` | `/api/attendance` | Add Entry |
| `GET` | `/api/attendance/settings` | Get Settings |
| `PUT` | `/api/attendance/settings` | Put Settings |
| `PUT` | `/api/attendance/{eid}` | Edit Entry |
| `POST` | `/api/attendance/{eid}/delete` | Delete Entry |
| `GET` | `/api/audit` | Audit Log |
| `POST` | `/api/auth/login` | Auth Login |
| `POST` | `/api/auth/verify` | Auth Verify |
| `GET` | `/api/client-packages` | Client Packages |
| `POST` | `/api/client-packages` | Sell Package |
| `POST` | `/api/client-packages/{kid}/payments` | Package Payment |
| `POST` | `/api/client-packages/{kid}/sessions` | Package Session |
| `GET` | `/api/dashboard` | Dashboard |
| `POST` | `/api/expenses` | 6xxx expense, 2000 pay supplier bill, 3200 drawings. pending = bill received but not paid yet (Cr 2000 payable). |
| `GET` | `/api/exports/{file}` | /api/exports/accountant-pack.xlsx (all reports) · /api/exports/<report>.csv|.xlsx (e.g. general-ledger.csv, sst-02-summary.xlsx). |
| `GET` | `/api/health` | Health |
| `GET` | `/api/inventory` | Active products. ?all=true also returns deleted (archived) ones, which past records still refer to. |
| `POST` | `/api/inventory` | Create Product |
| `PUT` | `/api/inventory/{item_id}` | Update Product |
| `DELETE` | `/api/inventory/{item_id}` | Delete = archive. Past prescriptions/invoices keep the name; stock left is written off (Dr 5030, Cr 1200). |
| `POST` | `/api/inventory/import` | All-or-nothing: every row is checked first; any error → 400 with the row list and nothing is saved. |
| `POST` | `/api/inventory/{item_id}/reorder` | Reorder |
| `POST` | `/api/inventory/{item_id}/receive` | Stock received on credit: Dr 1200 inventory, Cr 2000 supplier payable. |
| `GET` | `/api/invoices` | Invoices |
| `GET` | `/api/journal` | Journal |
| `GET` | `/api/me` | Me |
| `POST` | `/api/me/password` | Any signed-in user. Other devices are signed out; this one needs to sign in again too. |
| `POST` | `/api/opening-balances` | Go-live balances, posted against 3000 Owner's capital. Once only. |
| `GET` | `/api/packages` | List Packages |
| `POST` | `/api/packages` | Create Package |
| `PUT` | `/api/packages/{gid}` | Applies to new sales only: each sold package keeps a copy of its terms. |
| `DELETE` | `/api/packages/{gid}` | Stops selling it. Clients who bought it keep their sessions on the terms they paid for. |
| `POST` | `/api/packages/import` | All-or-nothing. Each row is one whole package {id?, name, price, items:[{svc, n}]}; the web app groups the CSV lines. |
| `GET` | `/api/patients` | List Patients |
| `POST` | `/api/patients` | Create Patient |
| `PUT` | `/api/patients/{pid}` | Update Patient |
| `GET` | `/api/patients/{pid}` | Full record: details, visits with notes + medicines, packages + payments, invoices. Viewing is audited (PDPA). |
| `POST` | `/api/payments` | Money in outside Billing (retail sale, other income). SST from the patient's citizenship. |
| `GET` | `/api/queue` | Queue |
| `POST` | `/api/queue/clear` | Clears a day's queue for one unit: removes entries not started (booked / waiting) and hides finished visits |
| `GET` | `/api/reports/{name}` | Report |
| `GET` | `/api/roles` | Roles |
| `GET` | `/api/services` | Therapy menu. ?all=true also returns deleted therapies (past records refer to them). |
| `POST` | `/api/services` | Create Service |
| `PUT` | `/api/services/{sid}` | Update Service |
| `DELETE` | `/api/services/{sid}` | Delete Service |
| `POST` | `/api/services/import` | All-or-nothing. Row with id updates that therapy; without id it matches by name, else adds. |
| `GET` | `/api/settings/sst` | Get Sst |
| `PUT` | `/api/settings/sst` | Put Sst |
| `GET` | `/api/setup` | Setup |
| `GET` | `/api/state` | State |
| `GET` | `/api/transactions` | Transactions |
| `POST` | `/api/transactions/{tid}/status` | pending → paid | failed | cancelled · failed → pending | paid | cancelled · paid → cancelled (refund/void, postings reversed). |
| `GET` | `/api/users` | List Users |
| `POST` | `/api/users` | Create User |
| `PUT` | `/api/users/{uid}` | Update User |
| `POST` | `/api/users/{uid}/password` | Admin sets a new password (e.g. forgotten). The user is signed out everywhere. |
| `POST` | `/api/visits` | Create Visit |
| `POST` | `/api/visits/{vid}/check-in` | Check In |
| `POST` | `/api/visits/{vid}/cancel` | Cancel Visit |
| `DELETE` | `/api/visits/{vid}` | Delete an appointment that hasn't been checked in. Kept in the audit log. |
| `POST` | `/api/visits/{vid}/start` | Start Visit |
| `PUT` | `/api/visits/{vid}/notes` | Visit Notes |
| `POST` | `/api/visits/{vid}/rx` | Safety check: 422 safety_block (allergy / pregnancy / stock); 201 with warning (diabetes). |
| `DELETE` | `/api/visits/{vid}/rx/{rid}` | Del Rx |
| `POST` | `/api/visits/{vid}/complete` | Complete Visit |
| `POST` | `/api/visits/{vid}/dispense` | Dispense |
| `GET` | `/api/visits/{vid}/invoice-preview` | Invoice Preview |
| `POST` | `/api/visits/{vid}/pay` | cash/card/duitnow → paid now; transfer → PENDING (Dr 1100) until confirmed; package → one PAID session (Dr 2100 Cr 4030). |

## Products (pharmacy & stock)

- Body fields: `name, form, unit, stock, reorder, price, cost, batch, exp, base, sugar, contra[], use`. Rules and messages: `app/products.py` (same as the web app).
- Delete = archive; blocked (409 `in_use`) while on a prescription waiting to be dispensed. `POST /inventory/import` is all-or-nothing (max 2,000 rows).
- Books: opening stock Dr 1200 / Cr 3000 · stock count or cost change Dr/Cr 1200 ↔ 5030 · delete writes off remaining stock Dr 5030 / Cr 1200.

## Therapy menu and packages

- Editing needs role `finance` or `admin`; everyone signed in can read. Rules and messages: `app/catalog.py` (same as the web app's `src/lib/catalog.js`).
- Therapy fields: `code, name, group (wellness | walk-in | add-on), mins, price, normal, label (promo | member | special), benefits, advance`. New ids are `th1, th2 …`.
- Package fields: `name, price, items: [{svc, n}]` (svc = therapy id or code; 1–100 sessions each; total ≤ 200). `sessions` = total of items. New ids are `pkg1 …`.
- Delete = archive. A therapy can't be deleted while an on-sale package includes it (409 `in_use`). A deleted package can't be sold; clients who bought it keep their sessions.
- Each sold package keeps a copy of its terms (name, price, sessions, therapies): editing a package applies to new sales only.
- Sessions: `POST /client-packages/{id}/sessions {serviceId}` and `POST /visits {serviceId: "session", packageServiceId}` record which therapy was done. Errors 409: `choose_therapy`, `not_in_package`, `therapy_used_up`, `balance_due`. Packages without a therapy list accept any therapy.
- `POST /services/import` and `POST /packages/import` are all-or-nothing. The web app turns the package CSV (one row per therapy) into one row per package.

## Users and roles
- Roles: `admin`, `bams` (BAMS doctor), `therapist`, `cashier` (see `app/roles.py`). `/users*` is admin only; `/me/password` is for everyone.
- Every request checks the user record: deactivating, changing role or resetting a password ends that person's sign-ins at once (401 `signed_out`).
- Safety: you can't change your own role or deactivate yourself (409 `self`); the last active admin stays (409 `last_admin`). Passwords: 10+ characters with letters and numbers.

## Appointments and queue
- `POST /visits` with `kind: "appt"` takes `date` (YYYY-MM-DD, today up to a year ahead) and `slot` (HH:MM). Walk-ins are always today.
- `DELETE /visits/{id}`: only appointments not yet checked in (409 `not_deletable`). Kept in the audit log.
- `POST /queue/clear {unitId, date?}`: removes booked / waiting entries, hides finished visits (still in records), leaves visits in progress.

## Patients
- Optional vitals: `heightCm` (30–250), `weightKg` (1–350), `bp` ("120/80"; systolic above diastolic).

## Packages: plans and validity
- Package fields add `code` (e.g. "PLAN 1"), `duration`, `validityMonths` (1–60), `inclusions` (list). With no `items`, give `sessions`: a flexible package.
- A sold package keeps its validity. `expiresOn` = sale date + months (inclusive). Sessions after that: 409 `package_expired`.

## Attendance
- `POST /attendance/clock-in`, `/clock-out` (signed-in user), `GET /attendance/today`.
- `GET /attendance?from&to[&userId]`: admins see everyone, others only themselves. Returns entries, users (with `since`) and a summary.
- Admin: `POST /attendance` (work time, or leave over a date range), `PUT /attendance/{id}` (reason required), `POST /attendance/{id}/delete` (reason required),
  `PUT /attendance/settings` (`start`, `end`, `grace`, `workdays` as ISO weekdays). No absences are counted before a login was created.

## Email (Amazon SES)
- `POST /visits/{id}/complete` reserves the invoice number (`Visit.bill_no`, INV-YYYY-#####) and returns `{status, invoice}`; payment later uses the same number. The invoice email goes to the patient after the response (skipped when the total is RM0 or the patient has no email; `INVOICE_EMAILS=off` turns it off).
- Receipts are emailed after: `POST /visits/{id}/pay` when paid, package sale, package balance payment, and an incoming transfer set to `paid` in accounting.
- `POST /invoices/{invNo}/email {kind: "invoice"|"receipt"}`: send again (receipt on an unpaid bill → 409 `not_paid`).
- `GET /emails[?ref=]`: email log (kind, to, subject, ref, status `sent|logged|failed|not_configured|skipped`, error). Sign-in codes are never stored.
- State: invoice rows carry `emails: {invoice, receipt}` (latest log entry each); queue rows carry `billNo`.
- `EMAIL_PROVIDER`: `ses`, `log` (print only), `memory` (tests). In development the sign-in code is always printed in the server console.
