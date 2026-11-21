# Dhanwanthari clinic — one container: FastAPI + SQLite serving the web app (/) and the API (/api) on port 8080.
# Build from the PROJECT ROOT (docker compose does this):  docker build -f dhanwanthari-server/Dockerfile .
# Stage 1 builds the web app from dhanwanthari-web, so a git checkout needs no prebuilt frontend.

FROM oven/bun:1 AS web
WORKDIR /web
COPY dhanwanthari-web/package.json dhanwanthari-web/bun.lock ./
RUN bun install --frozen-lockfile
COPY dhanwanthari-web/ ./
RUN bun run build

FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1 PORT=8080 \
    DATABASE_URL=sqlite:////app/data/clinic.db FRONTEND_DIR=/app/frontend
WORKDIR /app
COPY dhanwanthari-server/pyproject.toml dhanwanthari-server/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY dhanwanthari-server/ ./
COPY --from=web /web/dist ./frontend
RUN uv sync --frozen --no-dev && useradd -r -u 10001 clinic && mkdir -p data && chown -R clinic /app/data
USER clinic
EXPOSE 8080
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8080/api/health')"
CMD ["sh", "scripts/start.sh"]
