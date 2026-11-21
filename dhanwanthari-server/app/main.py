"""Dhanwanthari clinic server — FastAPI + SQLModel + SQLite.

One process serves both:
  /api/*        the clinic API
  /config.json  tells the web app to run in live mode (FRONTEND_MODE)
  /             the built web app (FRONTEND_DIR, index.html + assets)
Run:  uv run uvicorn app.main:app --host 0.0.0.0 --port 8080   (or: sh scripts/start.sh)
"""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import errors
from .config import settings
from .routers import accounting, attendance, catalog, clinic, state, users

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
settings.secret()  # fail fast in production when JWT_SECRET is missing

app = FastAPI(title="Dhanwanthari Clinic API", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
errors.install(app)
if settings.allowed_origins:
    app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.url.path.startswith("/api/"):
        resp.headers.setdefault("Cache-Control", "no-store")   # patient data is never cached
    return resp


app.include_router(clinic.router)
app.include_router(accounting.router)
app.include_router(state.router)
app.include_router(catalog.router)
app.include_router(users.router)
app.include_router(attendance.router)


@app.get("/config.json", include_in_schema=False)
def web_config():
    return JSONResponse({"api": "/api", "mode": settings.frontend_mode}, headers={"Cache-Control": "no-store"})


# --------------------------------------------------------------------------- built web app (single-page app)
_front = Path(settings.frontend_dir)


@app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
def web_app(path: str):
    if path.startswith("api/"):
        return JSONResponse({"error": "not_found", "message": "Unknown API endpoint."}, status_code=404)
    if not (_front / "index.html").exists():
        return JSONResponse({"ok": True, "message": "API is running. Put the built web app in FRONTEND_DIR to serve it here.", "docs": "/api/docs"})
    f = (_front / path).resolve()
    if path and f.is_file() and _front.resolve() in f.parents:
        cache = "public, max-age=31536000, immutable" if "/assets/" in f.as_posix() else "no-cache"
        return FileResponse(f, headers={"Cache-Control": cache})
    return FileResponse(_front / "index.html", headers={"Cache-Control": "no-cache"})
