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
pnpm test             # Vitest (api package)
```

Package-specific test commands:
```bash
pnpm --filter api test        # vitest run
pnpm --filter api test:watch  # vitest
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
- `compose`: the compose service(s) it owns, merged verbatim into the generated file
- `generate`: secrets minted once and kept in `internal.<id>.<key>`
- `dirs` / `reset.dirs`: directories to create before boot / wipe on reconfigure
- `notes`: manual steps or quirks, shown as a dashboard tooltip and inline in the
  wizard. Plain text — rendered as-is, no markdown
- `credentials`: fields the frontend renders in the Credentials step
- `setup`: ordered steps. Step types:
  - `wait_ready` — polls a `url` until it responds OK. Optional `match` regex:
    keep polling until the body matches, for a service that answers before it is
    actually usable
  - `api_call` — sends a request (`url`, `method`, `body`). Optional `ignoreStatus`
    array, and `skipIf: {url, match}` to no-op when a probe shows the work is
    already done — for APIs that answer a duplicate with a second copy, not a 409
  - `config_file` — writes `content` to `file` under `paths.config`
  - `extract_from_logs` / `extract_from_config` — pull a value out via regex
- `actions`: on-demand steps the dashboard exposes at `/services/:name/actions/:action`.
  `label` is the button's text, and optional `icon` picks its glyph from
  `web/src/components/ui/ActionIcon.tsx` — names are case-sensitive and listed in
  the README; an unknown one silently falls back to the default

**No file under `src/` names a service.** Adding one is dropping a `.yml` in
`templates/` and nothing else — that invariant is the point of the design, so
resist adding a service-specific branch anywhere in the API.

Templates reach each other through variables rather than code:
`{{internal.<service>.<key>}}`, `{{credentials.<service>.<key>}}` and
`{{services.<service>.enabled}}`. That is how MediaManager picks up the API key
Stupeflix generated for Prowlarr, and how it switches its own integrations on.

`config_file` steps run **before** `docker compose up` (a container reads its
config at boot); everything else runs after. The phase comes from the step type.

### API (`packages/api/`)

```
src/
├── index.ts              # Entry point - loads templates, Hono server, serves the web build
├── db.ts                 # sql.js SQLite wrapper (per-service defaults come from templates)
├── lib/
│   ├── env.ts            # Runtime config (paths, service host, PUID/PGID/TZ) from env vars
│   ├── docker-cli.ts     # `docker compose` command builder (file + project name)
│   ├── template-vars.ts  # Builds and resolves {{...}} — the only place vars are defined
│   ├── service-registry.ts # Loads YAML templates, mints secrets, runs setup steps
│   ├── setup-runner.ts   # Phases (pre_up/post_up), foreach expansion, step statuses
│   ├── compose.ts        # Merges the enabled templates' `compose:` blocks
│   ├── service-install.ts # Install / reconfigure / remove one service
│   ├── library-stats.ts  # Counts each library off the filesystem, plus disk
│   ├── helpers.ts        # Media/template dirs, reconfigure reset (global + scoped)
│   └── logger.ts         # Logging utility
└── routes/
    ├── setup.ts          # /setup/* routes (async setup, status)
    ├── install.ts        # /install/:name — one service, same runner
    ├── settings.ts       # /settings/* routes
    ├── docker.ts         # /docker/* routes
    └── services.ts       # /services/* routes, incl. reconfigure and DELETE
```

`setup.ts` drives `setup-runner.ts` directly; installing, reconfiguring and
removing **one** service all go through `lib/service-install.ts`. Keep that
orchestration there rather than duplicating it into a route — a first install and
a reconfigure must never drift apart, which is why they are one function with a
`reset` flag.

Two invariants that are easy to break:

- **A reset is scoped.** `cleanConfigs` clears every template, `cleanServiceConfig`
  clears one. Reconfiguring Jellyfin must not replay Plex's startup wizard, so use
  the per-template lists (`getTemplateConfigFiles`, `getTemplateResetDirs`).
- **Removal never names a container.** A template may own several (MediaManager
  has a Postgres sidecar), so it disables the service, rewrites the compose file
  and lets `up -d --remove-orphans` collect what is no longer declared. The
  service's directory under `paths.config` is deliberately kept.

### Tests (`pnpm test`)

Vitest, colocated as `src/**/*.test.ts`. Fixture templates live in
`src/test/fixtures/` so the engine is exercised without touching the real ones.

`src/templates.test.ts` is the important one: it runs against the **real**
`templates/` directory and asserts what the code no longer can — that every
`{{...}}` reference resolves, that `container_name` matches `container`, that
compose service names and host ports do not collide, and that MediaManager only
ever sets `MEDIAMANAGER_*` variables. **A new service template must keep it
green** — that suite is what replaces the per-service code that used to exist.

There is no test for the docker-facing paths (`compose up`, `rm --remove-orphans`,
live service APIs) — which now includes reconfiguring and removing a service.
Changes there need a real run: see the isolated recipe in the README, and never
against a live stack.

### Web (`packages/web/`)

```
src/
├── main.tsx          # React entry point
├── App.tsx           # QueryClientProvider wrapper
├── api/client.ts     # API client
├── hooks/            # React Query hooks
├── components/
│   ├── Wizard.tsx    # Main wizard container
│   ├── Dashboard.tsx # Library tiles, service cards, add/reconfigure screens
│   ├── StepIndicator.tsx
│   ├── steps/        # PathsStep, CredentialsStep, ServicesStep, ProgressStep
│   └── ui/           # Button, Input, Toggle, StatusBadge, ActionIcon, InfoTooltip
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
- The compose project is always `stupeflix`, never derived from the working
  directory: running from source and running the image must own the same
  containers, or they collide on `container_name`.
- The compose file lives next to the database (`data/`), so pointing an image at
  the dev server's `data/` directory shares the whole state.

## Key Files

- `templates/*.yml` - Service definitions (credentials, setup pipeline)
- `packages/api/src/lib/service-registry.ts` - Template loader and setup step runner
- `packages/api/src/routes/setup.ts` - Async setup with status polling
- `packages/web/src/components/Wizard.tsx` - Setup wizard UI (fetches registry from API)
- `docker-compose.yml` - Generated container definitions

## UI Conventions

- All user-facing text must be in English
- UI components: Button, Input, Toggle, StatusBadge, RadioGroup, Accordion,
  ActionIcon, InfoTooltip (`packages/web/src/components/ui/`)
- **Colours come from `tailwind.config.js`, never Tailwind's stock greys.**
  `brand` is the logo's neon rose; `ink` is three grounds — `950` page, `900`
  panel, `800` card, `700` icon tile. Edges are white-alpha hairlines
  (`border-white/[0.07]`, `/[0.12]`), not solid greys: a grey line on a dark
  ground muddies everything.
- Changing `tailwind.config.js` needs a dev-server restart — Vite does not pick it
  up hot, and `@apply` with a new token fails the PostCSS build until it does.
- New icons come from Heroicons outline paths. Hand-drawn SVG reads as noise at
  the 14px these render at.

## Linting Rules

Biome enforces strict TypeScript rules:
- `noExplicitAny`: error
- `noUnusedVariables`, `noUnusedImports`: error
- `useConst`, `noVar`: error
