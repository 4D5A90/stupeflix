# Stupeflix

![stupeflix](https://github.com/user-attachments/assets/c85b1227-8c29-4b24-aba0-d9df7f94dd1c)

Self-hosted media stack orchestrator with a web-based setup wizard.

## Quick Start (Docker)

Only Docker is required — the image builds the API and the wizard itself.

```bash
docker build -t stupeflix .

docker run -d --name stupeflix \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /srv/stupeflix:/srv/stupeflix \
  -v stupeflix-data:/data \
  --add-host=host.docker.internal:host-gateway \
  stupeflix
```

Open `http://localhost:3000` and follow the setup wizard.

| Mount | Why |
|-------|-----|
| `/var/run/docker.sock` | Stupeflix drives the host Docker daemon to run your media stack |
| `/srv/stupeflix` | Config, media and torrents. **Mounted at the same path inside**, so the bind mounts Stupeflix generates resolve on the host. Every path set in the wizard must live under it |
| `stupeflix-data:/data` | SQLite database and generated `docker-compose.yml` |

`--add-host` is only needed on Linux; Docker Desktop and OrbStack provide
`host.docker.internal` out of the box. To use another host directory, change both
sides of the mount and pass `-e STUPEFLIX_ROOT=/your/path`.

### Alternating between the image and `pnpm dev`

Both use the compose project `stupeflix`, so neither steals the other's
containers. To also share credentials and setup state, point `/data` at the
directory the dev server uses and match the ownership it generates:

```bash
docker run -d --name stupeflix \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /srv/stupeflix:/srv/stupeflix \
  -v "$PWD/packages/api/data:/data" \
  -e STUPEFLIX_ROOT=/srv/stupeflix \
  -e PUID=$(id -u) -e PGID=$(id -g) \
  stupeflix
```

Without matching `PUID`/`PGID`, each switch rewrites the compose file and Docker
recreates every container.

| Env var | Default (image) | Description |
|---------|-----------------|-------------|
| `STUPEFLIX_ROOT` | `/srv/stupeflix` | Host directory mounted at the same path; prefills the wizard |
| `STUPEFLIX_SERVICE_HOST` | `host.docker.internal` | Host reachable from the container, where services publish their ports |
| `STUPEFLIX_DB_PATH` | `/data/stupeflix.db` | SQLite database |
| `STUPEFLIX_COMPOSE_FILE` | `/data/docker-compose.yml` | Generated compose file |
| `STUPEFLIX_COMPOSE_PROJECT` | `stupeflix` | Compose project name |
| `PUID` / `PGID` | `1000` | Ownership applied to the service containers |
| `PORT` | `3000` | HTTP port (API + wizard) |

## Development

Requires Node.js and pnpm (`npm install --global pnpm`) on top of Docker.

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173`. In dev the API runs on port 3000 and Vite proxies
`/api` to it; in the image the API serves the built wizard on the same port.

## How it Works

1. **Paths** — Choose where to store config, media, and torrents. Define media libraries (Movies, TvShows, etc.). When a host root is mounted (`STUPEFLIX_ROOT`), these are prefilled under it.
2. **Services** — Pick a torrent client, one or more media servers, and optional extras (e.g. the JOAL seeder)
3. **Credentials** — Set usernames and passwords (auto-generate available)
4. **Setup** — Review and launch. Stupeflix generates `docker-compose.yml`, starts containers, and configures each service automatically

> **Reconfigure is a reset, not an edit.** Re-running the wizard stops the stack
> and clears each service's *generated* config so setup can run fresh —
> `jellyfin`/`emby` config dirs are wiped entirely (their startup wizard is
> replayed), and the generated files for qBittorrent, Transmission, MediaManager
> and JOAL are removed and regenerated. Your **media files and JOAL torrents are
> never touched**. To change a single service without a full reset, use the
> per-service install (`POST /install/:name`).

## Services

The wizard offers exactly the services defined in `templates/` — the backend
builds its registry from those files, so this list is the source of truth:

| Service | Container | Port | Category | Default | Credentials |
|---------|-----------|------|----------|:---:|-------------|
| qBittorrent | `qbittorrent` | 8080 | Torrent Client | on | user, pass |
| Jellyfin | `jellyfin` | 8096 | Media Server | on | user, pass |
| Plex | `plex` | 32400 | Media Server | off | claim |
| JOAL | `joal` | 6060 | Seeder | off | path, token |

Only the **Torrent Client** category is single-select; media servers and the
seeder are independent toggles, so you can enable several at once.

> The compose generator (`lib/compose.ts`) still carries definitions for
> Transmission, Emby and MediaManager, but they have no template yet, so they do
> **not** appear in the wizard. Drop a `templates/*.yml` file to surface one.

### JOAL

JOAL's web UI is reached at `/<path>/ui/` (the `path` credential, default
`joalui`). Its connection settings — **path prefix** and **secret token** — are
passed as container arguments from your credentials, *not* stored in a config
file. The JOAL UI then caches them in the browser's `localStorage` (`guiConfig`)
and never refreshes them on its own: if you reconfigure JOAL, a new token is
generated and the browser keeps the old one. The live values are always
`docker inspect joal`.

## Media Libraries

Libraries are defined in the first step of the wizard (under Media Path). Each library has a name and a type (`movies`, `tvshows`, or `music`). Default: Movies + TvShows.

During setup, Stupeflix automatically:
- Creates the folders on disk
- Creates matching libraries in each enabled media server (Jellyfin, Plex, etc.)
- Creates matching download categories in the torrent client (qBittorrent, etc.)

## Service Templates

Services are defined as YAML files in `templates/`. Add new services by dropping a `.yml` file — no code changes needed.

```yaml
id: myservice
name: My Service
description: What it does
category: mediaServer
defaultEnabled: false
container: myservice
port: 8080

credentials:
  - key: user
    type: text
    label: Username
    default: admin
  - key: pass
    type: password
    label: Password
    rules:
      minLength: 6

setup:
  - name: wait_ready
    type: wait_ready
    label: Wait for API
    url: http://localhost:8080/health

  - name: configure
    type: api_call
    label: Configure service
    url: http://localhost:8080/api/setup
    method: POST
    body:
      username: "{{credentials.user}}"
      password: "{{credentials.pass}}"
```

### Step types

| Type | Description |
|------|-------------|
| `wait_ready` | Poll a URL until the service responds |
| `api_call` | HTTP request with retry, cookies, tokens, custom headers |
| `config_file` | Handled by imperative code in `configs.ts` |
| `extract_from_logs` | Extract a value from container logs via regex |
| `extract_from_config` | Extract a value from a config file via regex |

### Template variables

| Variable | Source |
|----------|--------|
| `{{credentials.key}}` | Credential values from the wizard |
| `{{internal.key}}` | Values stored by previous steps (tokens, passwords) |
| `{{library.name}}` | Library folder name (in `foreach: libraries` steps) |
| `{{library.type}}` | Library type: `movies`, `tvshows`, `music` |

### `foreach: libraries`

Steps with `foreach: libraries` are expanded once per media library. Use `typeMap` to map standard library types to service-specific values:

```yaml
- name: add_library
  type: api_call
  foreach: libraries
  typeMap:
    movies:
      content_type: movie
      agent: tv.plex.agents.movie
    tvshows:
      content_type: show
      agent: tv.plex.agents.series
  url: http://localhost:32400/library/sections?type={{library.content_type}}&agent={{library.agent}}
  method: POST
```

Mapped values are injected as `{{library.key}}`.

### `api_call` options

| Option | Description |
|--------|-------------|
| `contentType: form` | Send body as `application/x-www-form-urlencoded` |
| `storeCookie: true` | Save response cookie for subsequent calls |
| `useCookie: true` | Send stored cookie |
| `storeToken: AccessToken` | Extract a JSON field from response and store as token |
| `useToken: true` | Send stored token as `Authorization` header |
| `headers: {}` | Custom request headers |
| `retryOn: [503]` | Retry on specific status codes (default: `[503]`) |
| `maxRetries: 10` | Max retry attempts (default: `10`) |
| `ignoreStatus: [400]` | Treat these status codes as success |

### Credential field rules

```yaml
credentials:
  - key: pass
    type: password
    label: Password
    rules:
      minLength: 6
      maxLength: 50
      pattern: "^[a-zA-Z0-9]+$"
      message: Custom error message
```

## API

Every route is served both at the root (for `pnpm dev`, where Vite strips the
`/api` prefix when proxying) and under `/api` (for the packaged image, where the
API also serves the built wizard on the same port).

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/runtime` | Mounted host root + service host (wizard prefill) |
| GET | `/status` | Setup state + container status |
| GET | `/registry` | Service definitions for the frontend |
| GET | `/templates` | List loaded template files |
| POST | `/templates/reload` | Reload templates from disk |
| POST | `/templates/upload` | Upload a new template |
| POST | `/setup/complete` | Start a full (re)configuration |
| GET | `/setup/status` | Track setup progress |
| POST | `/install/:name` | Install a single service (per-service flow) |
| GET | `/credentials` | Get stored credentials |
| GET | `/services` | List services with status |

## Stack

- **Backend**: Hono + sql.js + YAML templates
- **Frontend**: React + Vite + TailwindCSS + React Query
