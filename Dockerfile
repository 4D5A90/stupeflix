# syntax=docker/dockerfile:1

# ── Build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter api build && pnpm --filter web build

# The bundled API no longer sits next to node_modules, so ship the wasm explicitly
RUN find node_modules/.pnpm -path '*/sql.js/dist/sql-wasm.wasm' -print -quit \
    | xargs -I{} cp {} /src/sql-wasm.wasm && test -f /src/sql-wasm.wasm

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:22-alpine

# docker CLI + compose plugin: the app orchestrates the stack through the host daemon.
# curl/tar are used to fetch the Flood UI at setup time.
RUN apk add --no-cache docker-cli docker-cli-compose curl tar

WORKDIR /app

COPY --from=build /src/packages/api/dist ./dist
COPY --from=build /src/packages/api/migrations ./migrations
COPY --from=build /src/packages/web/dist ./public
COPY --from=build /src/sql-wasm.wasm ./sql-wasm.wasm
COPY templates ./templates

ENV NODE_ENV=production \
    PORT=3000 \
    PUID=1000 \
    PGID=1000 \
    STUPEFLIX_ROOT=/srv/stupeflix \
    STUPEFLIX_DB_PATH=/data/stupeflix.db \
    STUPEFLIX_COMPOSE_FILE=/data/docker-compose.yml \
    STUPEFLIX_COMPOSE_PROJECT=stupeflix \
    STUPEFLIX_TEMPLATES_DIR=/app/templates \
    STUPEFLIX_WEB_DIR=/app/public \
    STUPEFLIX_SQL_WASM=/app/sql-wasm.wasm \
    STUPEFLIX_SERVICE_HOST=host.docker.internal

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "dist/index.js"]
