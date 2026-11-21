#!/usr/bin/env sh
# Start the clinic server: load ../.env (project root) if present, apply database migrations,
# make sure setup data + the first admin exist, then serve on port 8080.
# SQLite: run ONE worker (the database allows one writer at a time).
set -e
cd "$(dirname "$0")/.."
if [ -f ../.env ] && [ -z "$DVC_ENV_LOADED" ]; then set -a; . ../.env; set +a; export DVC_ENV_LOADED=1; fi
mkdir -p data
uv run --frozen --no-dev alembic upgrade head
uv run --frozen --no-dev python -m app.seed
