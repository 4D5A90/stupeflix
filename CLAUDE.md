# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Stupeflix is a TypeScript monorepo for a self-hosted media stack orchestrator. It includes a backend API (Hono) and a frontend setup wizard (React + Vite).

## Monorepo Structure

```
stupeflix/
├── templates/        # YAML service definitions (loaded at runtime)
├── packages/
│   ├── api/          # Backend Hono API
│   └── web/          # Frontend React Wizard
├── pnpm-workspace.yaml
├── docker-compose.yml
└── data/             # SQLite DB
```

## Commands

From repo root:

```bash
pnpm install          # Install all workspace dependencies
pnpm dev              # Run api + web in parallel
pnpm dev:api          # Run API only
pnpm dev:web          # Run web only
pnpm build            # Build all packages
```

Package-specific:
```bash
pnpm --filter api dev     # Run API in dev mode
pnpm --filter api build   # Build API (esbuild bundle, see packages/api/build.mjs)
pnpm --filter web dev     # Run web dev server
pnpm --filter web build   # Build web
```

Packaged (single image, API serves the built wizard):
```bash
docker build -t stupeflix .
docker run -d -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /srv/stupeflix:/srv/stupeflix \
  -v stupeflix-data:/data \
  --add-host=host.docker.internal:host-gateway stupeflix
```

## Architecture

### Service Templates (`templates/`)

YAML files that declare each service: metadata, credentials, and setup pipeline. Loaded by the backend at startup and served to the frontend via `GET /registry`.

Each template defines:
- `id`, `name`, `description`, `category`, `defaultEnabled`, `container`, `port`
- `credentials`: fields the frontend renders in the Credentials step
- `setup`: ordered steps run after containers start. Step types:
  - `wait_ready` — polls a `url` until it responds OK
  - `api_call` — sends a request (`url`, `method`, `body`). Supports `{{credentials.key}}` template vars resolved from DB. Optional `ignoreStatus` array.
  - `config_file` — handled by `configs.ts` (imperative code)

To add a new service, create a YAML file in `templates/` — no code changes needed unless it requires `config_file` steps.

### API (`packages/api/`)

```
src/
├── index.ts              # Entry point - loads templates, Hono server, serves the web build
├── db.ts                 # sql.js SQLite wrapper
├── lib/
│   ├── env.ts            # Runtime config (paths, service host, PUID/PGID) from env vars
│   ├── docker-cli.ts     # `docker compose` command builder (file + project name)
│   ├── service-registry.ts # Loads YAML templates, runs setup steps
│   ├── compose.ts        # Docker Compose generation
│   ├── configs.ts        # Service configuration (config_file steps)
│   ├── prowlarr.ts       # Prowlarr auto-configuration
│   ├── helpers.ts        # Utility functions
│   └── logger.ts         # Logging utility
└── routes/
    ├── setup.ts          # /setup/* routes (async setup, status)
    ├── settings.ts       # /settings/* routes
    ├── docker.ts         # /docker/* routes
    └── services.ts       # /services/* routes
```

### Web (`packages/web/`)

```
src/
├── main.tsx          # React entry point
├── App.tsx           # QueryClientProvider wrapper
├── api/client.ts     # API client
├── hooks/            # React Query hooks
├── components/
│   ├── Wizard.tsx    # Main wizard container
│   ├── StepIndicator.tsx
│   ├── steps/        # PathsStep, CredentialsStep, ServicesStep, ProgressStep
│   └── ui/           # Button, Input, Toggle, StatusBadge
└── types/setup.ts    # TypeScript interfaces
```

### Running inside a container

The API shells out to `docker` and writes service configs on the host filesystem,
so everything path- or host-related goes through `lib/env.ts`:

- Host paths must be identical inside and outside the container — hence the single
  `STUPEFLIX_ROOT` bind mount, which also prefills the wizard (`GET /runtime`).
- Service containers publish on the host, so template URLs (`http://localhost:8096`)
  are rewritten to `STUPEFLIX_SERVICE_HOST` by `serviceUrl()`.
- Never call `docker compose` directly: use `compose()` from `lib/docker-cli.ts`,
  which pins `-f <generated file>` and the project name.
- Defaults keep host development unchanged (compose file at the repo root, no
  project name, `127.0.0.1` as service host).

## Key Files

- `templates/*.yml` - Service definitions (credentials, setup pipeline)
- `packages/api/src/lib/service-registry.ts` - Template loader and setup step runner
- `packages/api/src/routes/setup.ts` - Async setup with status polling
- `packages/web/src/components/Wizard.tsx` - Setup wizard UI (fetches registry from API)
- `docker-compose.yml` - Generated container definitions

## UI Conventions

- All user-facing text must be in English
- UI components: Button, Input, Toggle, StatusBadge, RadioGroup, Accordion (`packages/web/src/components/ui/`)

## Linting Rules

Biome enforces strict TypeScript rules:
- `noExplicitAny`: error
- `noUnusedVariables`, `noUnusedImports`: error
- `useConst`, `noVar`: error
