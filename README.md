# Dhanwanthari Vilasam · Clinic System

Clinic system for Dhanwanthari Vilasam Ayurveda Vaidyasala: patients, appointments & queue, consultations, wellness
therapies and packages, pharmacy & stock, billing (bills and receipts), accounting with Malaysian SST, staff attendance and
user administration.

One Python server serves the web app **and** the API on **port 8080**. All data is in one SQLite file.

| Folder / file | What it is |
|---|---|
| `dhanwanthari-server/` | FastAPI · SQLModel · SQLite · Alembic · uv (Python 3.13). Serves `/` (web app) and `/api`. |
| `dhanwanthari-web/` | React web app (Vite · Bun). Built into `dhanwanthari-server/frontend/`. |
| `.env.example` | All settings. Copy to `.env`. |
| `docker-compose.yml` | Docker deployment (app + Caddy for HTTPS). |
| `scripts/build-web.sh` | Builds the web app into the server (deployments without Docker). |

---

## Login

| | Email | Password | Code |
|---|---|---|---|
| **First admin** (clinic server) | `admin@dhanwanthari.test` | `Dhanwanthari@2026` | 6-digit code by email (or in the server console, see below) |
| Demo mode (web app without a server) | `admin@dhanwanthari.test` | `Dhanwanthari@2026` | `246810` |

- The first admin comes from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`. It is created on the **first start only**, if no user
  with that email exists. Changing `.env` later never changes an existing password.
- After the first sign-in: change the password (key button, top right), then add each staff member in **Administration**
  (roles: Admin, BAMS doctor (Ayurvedic Practitioner), Therapist, Cashier).
- **Sign-in code:** with email set up (Amazon SES) the code is emailed. Until then — and always in development
  (`APP_ENV=development`) — it is printed in the server console:
  ```
  WARNING dvc.mail: [otp] admin@dhanwanthari.test → 482913
  ```
  Docker: `docker compose logs -f app` · systemd: `journalctl -u dhanwanthari -f`.

---

## Settings (`.env`)

```bash
cp .env.example .env
openssl rand -hex 32     # run twice: one value for JWT_SECRET, one for OTP_PEPPER
```

| Setting | Meaning |
|---|---|
| `APP_ENV` | `production` on the clinic server, `development` on your computer |
| `JWT_SECRET`, `OTP_PEPPER` | Long random values (required in production) |
| `PORT` | `8080` (keep 8080 with Docker) |
| `DOMAIN` | e.g. `medical.levinova-ai.com` (Docker: Caddy gets the HTTPS certificate for it) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | First admin login (see above) |
| `EMAIL_PROVIDER` | `log` (print only) or `ses` (Amazon SES) |
| `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | SES region and keys (keys empty when the server has an IAM role) |
| `SES_FROM_EMAIL`, `SES_FROM_NAME`, `SES_REPLY_TO`, `SES_CONFIGURATION_SET` | Sender details (add later, see "Email with Amazon SES") |
| `INVOICE_EMAILS` | `on` / `off` — email the invoice when a visit is finished |
| `OTP_DELIVERY` | Production without email: `log` prints sign-in codes in the server log |

Format: one `NAME=value` per line, comments on their own line, `"quotes"` around values with spaces or `$`.

---

## Deploy with Docker (recommended)

Needs a Linux server with Docker + the Compose plugin, ports 80 and 443 open, and the domain's DNS **A record** pointing to the server.

```bash
# 1. put the project on the server, e.g. /opt/dhanwanthari
cd /opt/dhanwanthari
cp .env.example .env && nano .env          # secrets, DOMAIN, admin login, email

# 2. build and start (first build takes a few minutes: it also builds the web app)
docker compose up -d --build

# 3. watch the first start: migrations, set-up data, first admin, sign-in codes
docker compose logs -f app
```

Open `https://<DOMAIN>` and sign in. The data lives in `./data/clinic.db` on the host.

| Task | Command |
|---|---|
| Status / logs | `docker compose ps` · `docker compose logs -f app` |
| Restart (after editing `.env`) | `docker compose up -d` |
| Update to a new version | replace the project files (keep `.env` and `data/`), then `docker compose up -d --build` — database changes apply automatically |
| Backup now | `docker compose exec app uv run --no-dev python scripts/backup.py` → `./data/backups/` |
| Add a user from the command line | `docker compose exec app uv run --no-dev python -m app.seed --add-user EMAIL PASSWORD "Name" ROLE` |
| Reach the app without Caddy | uncomment `ports: ["127.0.0.1:8080:8080"]` in `docker-compose.yml` → `http://127.0.0.1:8080` |

---

## Deploy without Docker (Ubuntu 22.04 / 24.04)

```bash
# 1. system user and folder
sudo useradd -r -m -d /opt/dhanwanthari -s /usr/sbin/nologin clinic
sudo cp -r . /opt/dhanwanthari && sudo chown -R clinic:clinic /opt/dhanwanthari
cd /opt/dhanwanthari

# 2. uv (Python tool) for all users; Python 3.13 is installed by uv automatically
curl -LsSf https://astral.sh/uv/install.sh | sudo env UV_INSTALL_DIR=/usr/local/bin sh

# 3. settings
sudo -u clinic cp .env.example .env && sudo -u clinic nano .env

# 4. web app — the ZIP already contains it in dhanwanthari-server/frontend/.
#    From git (or after changing the web app) build it once (needs Bun: curl -fsSL https://bun.sh/install | bash):
sh scripts/build-web.sh

# 5. Python packages
cd dhanwanthari-server && sudo -u clinic uv sync --frozen --no-dev && cd ..

# 6. try it (stop with Ctrl+C): migrations, set-up data, first admin, then http://127.0.0.1:8080
sudo -u clinic sh dhanwanthari-server/scripts/start.sh

# 7. run it as a service (starts on boot, restarts if it stops)
sudo cp dhanwanthari-server/deploy/dhanwanthari.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now dhanwanthari
journalctl -u dhanwanthari -f
```

**HTTPS** — either:

- **Caddy** (automatic certificate): `sudo apt install caddy`, copy `dhanwanthari-server/deploy/Caddyfile.host` to
  `/etc/caddy/Caddyfile`, put your domain in it, `sudo systemctl reload caddy`.
- **nginx + certbot**: copy `dhanwanthari-server/deploy/nginx.conf` to `/etc/nginx/sites-available/dhanwanthari`, link it into
  `sites-enabled`, then `sudo certbot --nginx -d medical.levinova-ai.com`.

Both forward to `127.0.0.1:8080`. Firewall: `sudo ufw allow 80,443/tcp` (don't open 8080).

| Task | Command |
|---|---|
| Restart (after editing `.env`) | `sudo systemctl restart dhanwanthari` |
| Update | replace the files (keep `.env` and `dhanwanthari-server/data/`), `cd dhanwanthari-server && sudo -u clinic uv sync --frozen --no-dev`, restart |
| Backup now | `cd dhanwanthari-server && sudo -u clinic uv run --no-dev python scripts/backup.py` → `data/backups/` |
| Nightly backup (cron, 1 am) | `0 1 * * * cd /opt/dhanwanthari/dhanwanthari-server && uv run --no-dev python scripts/backup.py` |

Data: `dhanwanthari-server/data/clinic.db`.

---

## Email with Amazon SES

What is emailed:

| Email | When | To |
|---|---|---|
| Sign-in code | every sign-in | the staff member |
| **Invoice** (amount due, with its INV number) | a consultation or therapy is completed | the patient |
| **Official receipt** | payment by cash, card or DuitNow; a bank transfer confirmed as paid; package sale or balance payment | the patient |

The patient's email is on their record (Register / Edit patient). No email address → nothing is sent ("No email" on the bill).
Visits fully covered by a prepaid package (RM0) get no invoice. Billing shows the email status of every bill
(Emailed / No email / Email failed) and can **resend** the receipt. Patient emails are sent after the request finishes, so a
slow or failing mail service never holds up a payment.

### Add the sender details (when you have them)

1. **AWS console → Amazon SES**, choose a region, e.g. **Asia Pacific (Singapore) `ap-southeast-1`**.
2. **Verify the sender** (*Configuration → Identities → Create identity*):
   - **Domain** (recommended), e.g. `dhanwanthari.com.my`: add the 3 **DKIM CNAME** records SES shows to your DNS.
     Also add SPF (`v=spf1 include:amazonses.com ~all`) and DMARC (`_dmarc` TXT `v=DMARC1; p=none; rua=mailto:you@yourdomain`),
     so emails don't land in spam.
   - or a **single email address**: click the link SES emails to it.
3. **Leave the sandbox** (*Account dashboard → Request production access*). In the sandbox SES only sends to verified
   addresses, so patients won't receive anything until this is approved.
4. **IAM permissions** — create an IAM user (or, on AWS, an IAM role for the server) with this policy, then create an access key:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": ["ses:SendEmail", "ses:SendRawEmail"],
       "Resource": "*",
       "Condition": { "StringEquals": { "ses:FromAddress": "billing@dhanwanthari.com.my" } }
     }]
   }
   ```
5. **Fill in `.env`:**
   ```bash
   EMAIL_PROVIDER=ses
   AWS_REGION=ap-southeast-1
   AWS_ACCESS_KEY_ID=AKIA…            # leave empty when using an IAM role
   AWS_SECRET_ACCESS_KEY=…
   SES_FROM_EMAIL=billing@dhanwanthari.com.my
   SES_FROM_NAME="Dhanwanthari Vilasam"
   SES_REPLY_TO=ayurvedabrickfieldskl@gmail.com
   # optional: SES configuration set for bounce / complaint tracking
   SES_CONFIGURATION_SET=
   ```
6. **Restart** (`docker compose up -d` or `sudo systemctl restart dhanwanthari`).
7. **Test**: sign out and sign in → the code arrives by email. Register a patient with your own email, complete a visit
   (invoice), take a cash payment (receipt).

| Problem | Fix |
|---|---|
| "Email address is not verified" | SES is still in the sandbox, or the sender isn't verified in that region |
| "Sender not set up (SES_FROM_EMAIL)" | `SES_FROM_EMAIL` is empty |
| "… not authorized to perform ses:SendEmail" | IAM policy missing, or `ses:FromAddress` in the policy differs from `SES_FROM_EMAIL` |
| Emails in spam | add DKIM, SPF and DMARC (step 2) |
| Sign-in fails with "Couldn't send the sign-in code by email" | SES error in production — check `docker compose logs app` / `journalctl -u dhanwanthari`; set `EMAIL_PROVIDER=log` temporarily to sign in with the code from the log |

Every attempt is in the email log: `GET /api/emails` (sign-in codes themselves are never stored).

---

## Roles

| Role | Can do |
|---|---|
| Admin | Everything, incl. Administration (users), therapy menu & package prices, SST settings, opening balances, attendance register |
| BAMS doctor (Ayurvedic Practitioner) | Consultations, prescriptions, dispensing, pharmacy & stock |
| Therapist | Therapy sessions, package sessions |
| Cashier | Registration, queue & appointments, billing, package sales, payments & expenses, accounting reports |

Everyone clocks in and out (top of every page). Changing a role, deactivating someone or resetting a password signs them
out on every device at once.

## Day to day

- **Bills and receipts**: paying by cash, card or DuitNow opens the A5 official receipt with *Print receipt*. Every invoice
  has *Print bill* (A4) and *Receipt*. The print window also offers *Save as PDF*.
- **Packages**: the brochure plans (PLAN 1–5) are added automatically. Validity runs from the sale date; editing a package
  only changes new sales.
- **Backups**: copy `data/backups/` (or the whole `data/` folder) off the server regularly.
  Restore: stop the app, copy a backup over `clinic.db`, start it again.

## Develop on your computer

```bash
cp .env.example .env                       # set APP_ENV=development
cd dhanwanthari-server && uv sync && sh scripts/start.sh     # http://localhost:8080 (codes in this console)
cd dhanwanthari-web && bun install && bun run dev            # http://localhost:5173, /api → :8080
cd dhanwanthari-server && uv run pytest                      # 37 tests (temporary database, emails captured)
```

API reference: `dhanwanthari-server/docs/API.md` (live: `/api/docs`) · accounting & SST: `dhanwanthari-server/docs/ACCOUNTING.md`.
