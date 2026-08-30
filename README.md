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

### Windows

Run Stupeflix from **inside WSL 2** (Docker Desktop's default backend). Open your
WSL 2 distro and the Linux Quick Start above works verbatim — same `docker run`,
same `\` line breaks. Keep `STUPEFLIX_ROOT` on the **WSL 2 filesystem**
(e.g. `/home/<you>/stupeflix`), **not** under `/mnt/c/...`.

Why WSL 2 rather than PowerShell: Stupeflix mounts your directory at the *same
path* inside the container, and the host daemon must resolve that path again when
it creates the service containers. That only holds for Linux paths the WSL 2
daemon sees natively — a Windows path like `C:\media` cannot be mounted at
`C:\media` inside a Linux container, and Windows drives (`/mnt/c`, `D:`) are known
to break daemon-side bind mounts.

If you must drive Docker from **PowerShell** or **Git Bash** instead:

- Mount the socket with a leading double slash so the path isn't mangled:
  `-v //var/run/docker.sock:/var/run/docker.sock`
- Put the command on a single line — PowerShell continues lines with a backtick
  `` ` `` (not `\`), `cmd` uses `^`.
- Skip `--add-host` (Docker Desktop already provides `host.docker.internal`).
- The dev-sharing command below uses `$(id -u)` / `$(id -g)`, which are POSIX-only
  — run that one from inside WSL 2.

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

### Tests

```bash
pnpm test          # vitest, api package
```

They cover the template engine — variable resolution, compose generation, secret
minting, `config_file` writing, step phases — and, in `src/templates.test.ts`,
the real `templates/` directory: every `{{...}}` must resolve, `container_name`
must match `container`, and compose names and host ports must not collide. Adding
a service means keeping that suite green.

What they deliberately do **not** cover is anything that shells out to Docker or
talks to a live service. To check those, run the stack for real — but **do not
point it at your own setup**: a reconfigure deletes generated configs, and
`container_name` is a global Docker namespace. Run it isolated instead:

```bash
# Copy the templates and suffix their container_name, so nothing collides
mkdir -p /tmp/sfx/{config,media,torrents,data,templates}
for f in templates/*.yml; do
  sed -E 's/^([[:space:]]*container_name:[[:space:]]*)([A-Za-z0-9_-]+)$/\1\2-e2e/' \
    "$f" > "/tmp/sfx/templates/$(basename "$f")"
done

STUPEFLIX_TEMPLATES_DIR=/tmp/sfx/templates \
STUPEFLIX_DB_PATH=/tmp/sfx/data/stupeflix.db \
STUPEFLIX_COMPOSE_FILE=/tmp/sfx/data/docker-compose.yml \
STUPEFLIX_COMPOSE_PROJECT=stupeflix-e2e \
PORT=3999 pnpm --filter api dev
```

Then drive it with `POST /setup/complete` and poll `GET /setup/status`. Keep the
**published ports unchanged** — setup steps address services as `localhost:<port>`
— and only rename `container_name`: the compose service key is what containers
resolve each other by on the network.

## How it Works

1. **Paths** — Choose where to store config, media, and torrents. Define media libraries (Movies, TvShows, etc.). When a host root is mounted (`STUPEFLIX_ROOT`), these are prefilled under it.
2. **Services** — Pick a torrent client, one or more media servers, and optional extras (e.g. the JOAL seeder)
3. **Credentials** — Set usernames and passwords (auto-generate available)
4. **Setup** — Review and launch. Stupeflix generates `docker-compose.yml`, starts containers, and configures each service automatically

> **Reconfigure is a reset, not an edit.** Re-running the wizard stops the stack
> and clears each service's *generated* config so setup can run fresh. What gets
> cleared is not a list in the code: it is exactly the files the templates declare
> writing (`config_file` steps) plus the directories they list under `reset.dirs`
> — Jellyfin's config dir, for instance, so its startup wizard replays. Anything
> no template claims is user data and survives: your **media files, JOAL's seeded
> torrents, the indexers you added in Prowlarr, and MediaManager's database**.
> To change a single service without a full reset, use the per-service install
> (`POST /install/:name`).

## Services

The wizard offers exactly the services defined in `templates/` — the backend
builds its registry from those files, so this list is the source of truth:

| Service | Container | Port | Category | Default | Credentials |
|---------|-----------|------|----------|:---:|-------------|
| qBittorrent | `qbittorrent` | 8080 | Torrent Client | on | user, pass |
| Prowlarr | `prowlarr` | 9696 | Indexer | off | — |
| MediaManager | `mediamanager` | 8000 | Media Manager | off | email, pass |
| Jellyfin | `jellyfin` | 8096 | Media Server | on | user, pass |
| Plex | `plex` | 32400 | Media Server | off | claim |
| JOAL | `joal` | 6060 | Seeder | off | path, token |

Only the **Torrent Client** category is single-select; the others are independent
toggles, so you can enable several at once.

### MediaManager

MediaManager searches for movies and shows and hands the results to a torrent
client. It only earns its keep with both of its neighbours enabled:

- **qBittorrent** does the downloading. MediaManager gets its own category
  (`MediaManager`, saving to `/media/downloads`) so it never fights the
  per-library categories the wizard creates. The media root is mounted at
  `/media` in every container, so a path MediaManager reads back from
  qBittorrent's API points at the same file on both sides, and importing into a
  library is a rename rather than a copy.
- **Prowlarr** does the searching. Stupeflix generates its API key, injects it
  into Prowlarr via `PROWLARR__AUTH__APIKEY` and hands the same value to
  MediaManager — so neither needs configuring by hand. **You still have to add
  your own trackers** in Prowlarr's UI; without them there is nothing to search.

Both are wired entirely through environment variables in the templates. Note that
MediaManager's settings models **reject unknown keys**: a `MEDIAMANAGER_*`
variable its image does not define is a startup failure, so check the field names
against `/app/media_manager/*/config.py` in the image when bumping the tag.

On an empty database MediaManager creates its own admin from `admin_emails` with
the hardcoded password `admin`. Setup claims that account and replaces the
password with the one you chose, then logs in again to prove it took.

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

Services are defined as YAML files in `templates/`. A template owns **everything**
about its service — the container, the files it needs on disk, its setup pipeline
and its dashboard actions. No file under `packages/api/src` names a service, so
adding one is dropping a `.yml` and nothing else.

```yaml
id: myservice
name: My Service
description: What it does
category: mediaServer
defaultEnabled: false
container: myservice        # compose service name, and the container_name below
port: 8080                  # its web UI — omit it entirely for a headless service

# Merged verbatim into the generated docker-compose.yml when enabled.
# A service may declare several containers (a sidecar database, say).
compose:
  myservice:
    image: example/myservice:latest
    container_name: myservice
    environment:
      - PUID={{env.PUID}}
      - TZ={{env.TZ}}
      - API_KEY={{internal.api_key}}
    volumes:
      - "{{paths.config}}/myservice:/config"
      - "{{paths.media}}:/media"
    ports:
      - "8080:8080"
    restart: unless-stopped

# Secrets minted once and kept in internal.<id>.<key> across reconfigures
generate:
  - key: api_key
    type: hex        # or uuid
    length: 16       # bytes

# Shown inline in the wizard, and on the install screen, once the
# service is enabled. Use it for what setup cannot do for the user.
# Plain sentences only — they are rendered as text, not markdown.
notes:
  - Finish the last step in the service's own UI.

# Network topology, declared as a capability rather than by naming a peer.
# `provides` lends this service's network namespace; `join` asks for one.
# Both sides are optional and inert when unmatched — see "Networking" below.
network:
  join: vpn

dirs:                # created under paths.config before the container boots
  - myservice/cache

reset:               # wiped on reconfigure, to replay a startup wizard
  dirs:
    - myservice

# Fields the wizard renders. `type` is text, password, email or select.
credentials:
  - key: user
    type: text
    label: Username
    default: admin              # prefilled, and correct as-is
  - key: token
    type: password
    label: API Token
    placeholder: 10.64.0.1/32   # shape only, when a default would be wrong
  - key: region
    type: select                # the options belong here, never to the frontend
    label: Region
    default: eu
    options:
      - { value: eu, label: Europe }
      - { value: us, label: United States }
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

# Values the dashboard polls and shows on the card, beyond "running".
# Read server-side, so the URL never reaches the browser. Anything that fails —
# service down, wrong path — shows as a dash rather than as an error.
info:
  - name: exit_ip
    label: Exit IP
    url: http://localhost:8000/v1/publicip/ip
    extract: public_ip      # dotted path into the JSON; omit to use the whole body
    refresh: 300            # seconds, default 60

# Buttons the dashboard offers after setup, POSTed to
# /services/:name/actions/:action. Declaring one is what makes it appear —
# `label` becomes the button's tooltip, `icon` picks the glyph.
actions:
  scan:
    name: scan
    label: Scan libraries
    icon: refresh          # optional, see "Action icons" below
    type: api_call
    url: http://localhost:8080/api/refresh
    method: POST
```

### Step types

| Type | Description |
|------|-------------|
| `wait_ready` | Poll a URL until the service responds. `match`: keep polling until the body matches a regex, for a service that answers before it is usable |
| `api_call` | HTTP request with retry, cookies, tokens, custom headers. `skipIf: {url, match}`: probe first and skip the call when the work is already done |
| `config_file` | Write `content` to `file` under `paths.config` (`skipIfExists`, default true) |
| `extract_from_logs` | Extract a value from container logs via regex |
| `extract_from_config` | Extract a value from a config file via regex |

`config_file` steps run **before** `docker compose up`, since a container reads
its config at boot; every other step runs after. That ordering is derived from
the step type, not declared.

### Actions and readouts

Two things a card can carry, and they are not the same:

| | `actions:` | `info:` |
|---|---|---|
| Does | something | nothing |
| Returns | nothing | a value |
| Rendered as | a button | a label and a value |
| Triggered | on click | on a timer |

An action that needs to *show* you something belongs in `info:`; a readout that
changes the world belongs in `actions:`. Keeping them apart is why neither has
to grow the other's features.

### Networking

A service can route its traffic through another's tunnel. Neither template names
the other: one declares a capability, the other asks for it.

```yaml
# gluetun.yml
network: { provides: vpn }

# qbittorrent.yml
network: { join: vpn }
```

With both enabled, the generated compose file is rewritten so the joiner has **no
network of its own** — it lives inside the provider's namespace and cannot reach
the internet by any other route. That is a kill switch, not a setting:

```yaml
gluetun:
  ports: ["8001:8000", "8080:8080", "6881:6881"]   # the joiner's ports move here
qbittorrent:
  network_mode: "service:gluetun"
  depends_on: { gluetun: { condition: service_healthy } }
  # no ports of its own: a shared namespace cannot publish
```

**With no provider enabled, nothing happens** and the joiner's block is generated
verbatim. There is no second variant of a template to maintain.

Three consequences worth knowing before writing one:

- **Ports move to the provider.** Host port numbers are unchanged, so URLs, the
  dashboard's Open button and `wait_ready` on `localhost:<port>` keep working.
- **A joined container loses its DNS name.** Anything addressing it must use
  `{{host.<service>}}`, which resolves to the provider once it has joined. This
  is why `mediamanager.yml` writes `http://{{host.qbittorrent}}` and not
  `http://qbittorrent`.
- **A provider must declare a `healthcheck`**, because the joiner waits on
  `service_healthy` — starting before the tunnel is up would leak in the clear.

These keys are **refused** on a service that joins, because each is a property of
the shared namespace and moving it would silently change behaviour for the
provider and every other joiner: `networks`, `hostname`, `links`, `dns`,
`dns_search`, `extra_hosts`. Only `networks` is caught by `docker compose
config`; the rest fail at `up`, so `src/templates.test.ts` rejects them first.

### Action icons

An action's `icon` is optional. Left out, the button gets a generic action glyph;
naming one of the below swaps it. Names are **case-sensitive** — `Refresh` is not
`refresh`, and an unrecognised name silently falls back to the default rather
than breaking the button, so a typo is invisible in the UI.

| Name | Drawn as |
|------|----------|
| `refresh` | Circular arrows — also the only icon that spins while the action runs |
| `play` | Triangle |
| `stop` | Square |
| `power` | Power symbol |
| `download` | Arrow into a tray |
| `upload` | Arrow out of a tray |
| `trash` | Bin |
| `search` | Magnifier |
| `key` | Key — credentials |
| `open` | Arrow leaving a frame — open the service |
| `check` | Tick |
| `cog` | Gear — settings, reconfigure |

The list lives in `packages/web/src/components/ui/ActionIcon.tsx`, and
`src/templates.test.ts` reads it back to fail on a name no template can draw —
which is what catches the casing trap above.

### Template variables

| Variable | Source |
|----------|--------|
| `{{credentials.key}}` | Credential values from the wizard |
| `{{internal.key}}` | Generated secrets, and values stored by previous steps (tokens, passwords) |
| `{{paths.config}}` `{{paths.media}}` `{{paths.torrents}}` | Host paths from the wizard |
| `{{env.PUID}}` `{{env.PGID}}` `{{env.TZ}}` | Host wiring |
| `{{host.<service>}}` | The container another service must be addressed by — see Networking |
| `{{library.name}}` | Library folder name (in `foreach: libraries` steps) |
| `{{library.type}}` | Library type: `movies`, `tvshows`, `music` |
| `{{libraries.<type>_json}}` | All libraries of a type as `[{"name":…,"path":"/media/…"}]` |
| `{{internal.<service>.<key>}}` | **Another** service's secret |
| `{{credentials.<service>.<key>}}` | **Another** service's credential |
| `{{services.<service>.enabled}}` | `"true"` / `"false"` |

The last three are how two services connect without either the code or the other
template being changed: MediaManager reads
`{{internal.prowlarr.api_key}}` and switches itself on with
`{{services.prowlarr.enabled}}`.

An environment entry that resolves to an empty value (`FOO=`) is dropped from the
generated compose file, so an optional credential left blank falls back to the
image's own default instead of shadowing it.

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
