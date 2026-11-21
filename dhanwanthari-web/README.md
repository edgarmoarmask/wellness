# Dhanwanthari clinic system · web app

React 19 · Vite · Tailwind CSS v4 · Bun. Setup, deployment, email and login details are in the **project README** (`../README.md`).

## Develop
```bash
bun install
bun run dev        # http://localhost:5173 — /api is proxied to the clinic server on :8080
bun run build      # → dist/  (the Docker build does this for you)
```
Without a running server the app opens in **demo mode** (data kept in this browser):
sign in with `admin@dhanwanthari.test` / `Dhanwanthari@2026`, code `246810`.

`data/` holds clinic set-up only (units, practitioners, services, packages, sample stock). Patient data starts empty.
`public/config.json` → `"mode": "auto"` (live if the server answers, otherwise demo). The clinic server answers `/config.json` itself with `"mode": "live"`.
