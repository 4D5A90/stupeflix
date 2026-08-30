# SPEC.md — Stupeflix

## Overview

API-first orchestrator for a self-hosted media stack. A monorepo with a Hono
backend and a React wizard, whose defining property is that **no service is named
in the code**: each one is a YAML template in `templates/`, loaded at runtime.

This document specifies the contracts — endpoints, stored keys, the template
schema in outline. The template reference with every field lives in the README;
the design rules a change must respect live in CLAUDE.md.

## Monorepo Structure

```
stupeflix/
├── templates/                  # Service definitions, loaded at runtime
├── packages/
│   ├── api/                    # Backend Hono API
│   │   └── src/
│   │       ├── index.ts        # Loads templates, serves the API and the web build
│   │       ├── db.ts           # sql.js key/value store
│   │       ├── lib/
│   │       │   ├── env.ts             # Paths, service host, PUID/PGID/TZ
│   │       │   ├── docker-cli.ts      # `docker compose` builder (file + project)
│   │       │   ├── template-vars.ts   # Builds and resolves {{...}}
│   │       │   ├── service-registry.ts# Loads templates, mints secrets, runs steps
│   │       │   ├── setup-runner.ts    # Phases, foreach expansion, step statuses
│   │       │   ├── compose.ts         # Merges the enabled templates' compose blocks
│   │       │   ├── network.ts         # provides/join topology and its compose rewrite
│   │       │   ├── service-install.ts # Install / reconfigure / remove one service
│   │       │   ├── library-stats.ts   # Library counts and disk usage
│   │       │   ├── helpers.ts         # Directories, reconfigure reset
│   │       │   └── logger.ts
│   │       ├── routes/         # setup, install, services, settings, docker
│   │       └── test/           # Fixture templates, fake db
│   └── web/                    # Frontend React wizard + dashboard
│       └── src/
│           ├── App.tsx         # Shell: wizard, dashboard or install progress
│           ├── api/client.ts
│           ├── hooks/
│           ├── components/
│           │   ├── Wizard.tsx, Dashboard.tsx, InstallProgress.tsx
│           │   ├── steps/      # PathsStep, CredentialsStep, ServicesStep, ProgressStep
│           │   └── ui/         # Button, Input, Toggle, StatusBadge, RadioGroup,
│           │                   # Accordion, ActionIcon, ServiceIcon, InfoTooltip
│           └── types/setup.ts
├── pnpm-workspace.yaml
└── data/                       # SQLite DB + generated docker-compose.yml
```

## Services

Whatever `templates/` contains — this table is what ships today, not a fixed list.

| Service | Port | Description |
|---------|------|-------------|
| Stupeflix API | 3000 | Orchestrator backend |
| Stupeflix Web | 5173 | Setup wizard frontend (dev) |
| MediaManager | 8000 | Downloads and library management |
| Gluetun | 8001 | VPN tunnel (control server) |
| qBittorrent | 8080 | Torrent client |
| Jellyfin | 8096 | Media streaming |
| Prowlarr | 9696 | Indexer manager |
| Plex | 32400 | Media streaming |
| JOAL | user-set | Ratio seeder |

## Service Templates

A template owns everything about its service: metadata, compose block, generated
secrets, credential fields, setup pipeline, dashboard actions, and how it reaches
the network. Full field reference in the README.

```yaml
id: myservice
container: myservice          # must match a compose service and its container_name
port: 8080                    # web UI; omitted by a headless service

network:                      # optional
  join: vpn                   # or: provides: vpn

compose: { ... }              # merged verbatim into the generated file
generate: [ ... ]             # secrets minted once, kept as internal.<id>.<key>
credentials: [ ... ]          # fields the wizard renders — text, password,
                              # email or select (which carries its own options).
                              # `default` prefills, `placeholder` only hints
setup: [ ... ]                # ordered steps, run pre_up then post_up
actions: { ... }              # buttons the dashboard offers afterwards
info: [ ... ]                 # values it reports, polled and shown on its card
```

Templates connect to each other **without naming each other in code**:

| Mechanism | Used for | Example |
|-----------|----------|---------|
| `{{internal.<svc>.<key>}}` | A secret another service minted | MediaManager reads Prowlarr's API key |
| `{{credentials.<svc>.<key>}}` | A value the user typed elsewhere | MediaManager reuses qBittorrent's login |
| `{{services.<svc>.enabled}}` | Switching an integration on | `..._PROWLARR__ENABLED=true` |
| `{{host.<svc>}}` | Addressing a peer container | `http://{{host.qbittorrent}}` |
| `network: provides/join` | Sharing a network namespace | qBittorrent routed through Gluetun |

The first four substitute a **value** into a string. `network:` is the same idea
applied to **topology**, because a variable cannot move a YAML key: a joined
service gives up its own network stack, so its `ports` move to the provider and
it gains `network_mode` and `depends_on`. With no provider enabled, a `join` is
inert and the template renders unchanged.

## API Endpoints

### Setup

```
POST /setup/paths        ← { config, media, torrents }
POST /setup/credentials  ← { "<service>": { "<key>": "<value>" } }
POST /setup/services     ← { "<service>": { enabled: boolean } }

POST /setup/complete
  ← {
      "paths":       { "config": "…", "media": "…", "torrents": "…" },
      "libraries":   [ { "name": "Movies", "type": "movies" } ],
      "credentials": { "<service>": { "<key>": "<value>" } },
      "services":    { "<service>": { "enabled": true } }
    }
  → { "success": true }

GET /setup/status
  → {
      "global": "pending" | "in_progress" | "completed" | "failed",
      "steps":  { "<service>.<step>": "pending" | … },
      "error":  null
    }
```

Step keys are derived from the enabled templates' `setup:` pipelines, so the set
changes with the installed services. `compose` and `containers` are the two the
runner owns.

### Services

```
GET    /services                       → List with status, actions, notes
POST   /services/:name/start
POST   /services/:name/stop
POST   /services/:name/restart
POST   /services/:name/reconfigure     → Replay this template, scoped reset
DELETE /services/:name                 → Remove containers, keep config/
POST   /services/:name/actions/:action → An action the template declares
GET    /services/:name/info            → The values its `info:` block declares
GET    /services/:name/logs?lines=100
```

### Install

```
POST /install/:name  ← { credentials: { … } }   → One service, same runner
```

### Library

```
GET /library/stats
  → {
      "libraries": [ { "name", "type", "primary", "secondary",
                       "primaryUnit", "secondaryUnit" } ],
      "disk":      { "total", "free", "used" } | null
    }
```

Counted from the filesystem rather than from a media server's API, so the numbers
stay true with every service stopped and none is treated as canonical.

### Templates

```
GET  /registry           → Metadata the wizard renders
GET  /templates          → Loaded templates and their files
POST /templates/reload   → Re-read templates/ without restarting
POST /templates/upload   ← multipart .yml
```

### Settings, Docker, Runtime

```
GET    /settings         GET /settings/:key      PUT /settings
PUT    /settings/:key    DELETE /settings/:key

POST /docker/generate    POST /docker/up
POST /docker/down        POST /docker/pull

GET /runtime      → { root, serviceHost }
GET /credentials  → What the dashboard offers to copy
GET /health       → { status }
GET /status       → { setup_completed, containers }
```

## Frontend

### Wizard

| Step | Component | Fields |
|------|-----------|--------|
| 1 | PathsStep | config, media, torrents, and the media libraries |
| 2 | CredentialsStep | one section per enabled template, from its `credentials:` |
| 3 | ServicesStep | a toggle per template, grouped by category |
| 4 | ProgressStep | live step status, then completion |

```
[Paths] → [Credentials] → [Services] → POST /setup/complete
                                              ↓
                                   [ProgressStep] polls /setup/status
                                              ↓
                                       [Done] or [Error]
```

Nothing in the wizard is written per service: every field comes from a template's
`credentials:` block, and the categories come from its `category`.

### Dashboard

Shown once setup is complete. Library counters and disk first, then a card per
service with its declared actions, its state, and a menu for restart /
reconfigure / remove. Adding or reconfiguring a service opens its own screen.

### Types

```typescript
interface SetupConfig {
  paths: { config: string; media: string; torrents: string };
  libraries: Library[];
  credentials: Record<string, Record<string, string>>;   // per service
  services: Record<string, { enabled: boolean }>;
}

interface Library {
  name: string;
  type: "movies" | "tvshows" | "music";
}

interface SetupStatus {
  global: "pending" | "in_progress" | "completed" | "failed";
  steps: Record<string, "pending" | "in_progress" | "completed" | "failed">;
  error: string | null;
}
```

`credentials` is a map, not a fixed shape: the wizard cannot know which services
exist until it has read the registry.

## Database Schema

A single key/value table. Everything — paths, credentials, generated secrets,
per-service toggles, step statuses — is a key.

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch())
);
```

### Key Shapes

```
paths.config | paths.media | paths.torrents
libraries                                  JSON array of { name, type }

credentials.<service>.<key>                what the user typed
internal.<service>.<key>                   minted secrets, extracted tokens
services.<service>.enabled                 per-template toggle

setup.completed | setup.global | setup.error
setup.status.<service>.<step>              one per pipeline step
setup.status.<service>.<step>_<library>    a `foreach: libraries` step, once per library
```

Defaults for `services.*.enabled` come from each template's `defaultEnabled`, so
adding a template adds its key without a migration.

## Scripts

```bash
pnpm install          # Install all packages
pnpm dev              # Run api + web in parallel
pnpm build            # Build all
pnpm test             # Vitest (api package)

pnpm --filter api dev | build | test | test:watch
pnpm --filter web dev | build
```

## Environment

```bash
STUPEFLIX_ROOT             # Host directory bind-mounted at the same path
STUPEFLIX_DB_PATH          # SQLite file (default ./data/stupeflix.db)
STUPEFLIX_COMPOSE_FILE     # Generated compose file (default ./data/docker-compose.yml)
STUPEFLIX_COMPOSE_PROJECT  # Fixed as "stupeflix" so source and image own the same containers
STUPEFLIX_TEMPLATES_DIR    # Where templates are read from
STUPEFLIX_WEB_DIR          # Built frontend to serve alongside the API
STUPEFLIX_SERVICE_HOST     # How the API reaches service containers (host.docker.internal in a container)
STUPEFLIX_SQL_WASM         # sql.js wasm binary, once the API is bundled
PORT                       # API port (default 3000)
PUID | PGID | TZ           # Handed to service containers via {{env.*}}
DEBUG=true                 # Verbose logging
```
