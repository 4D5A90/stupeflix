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

Run Stupeflix from **inside WSL 2** — the Linux Quick Start above then works
verbatim. Keep `STUPEFLIX_ROOT` on the WSL 2 filesystem (`/home/<you>/stupeflix`),
**not** under `/mnt/c/...`.

The reason is the same-path mount: the host daemon has to resolve `STUPEFLIX_ROOT`
again when it creates the service containers, which only works for Linux paths it
sees natively. `C:\media` cannot be mounted at `C:\media` inside a Linux
container, and Windows drives break daemon-side bind mounts.

From **PowerShell** or **Git Bash** instead: double the socket's leading slash
(`-v //var/run/docker.sock:...`), put it on one line (PowerShell continues with
`` ` ``, `cmd` with `^`), drop `--add-host`, and run the dev-sharing command below
from WSL 2 — it uses `$(id -u)`.

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

They cover the engine, and in `src/templates.test.ts` the real `templates/`
directory — every `{{...}}` resolves, `container_name` matches `container`, ports
and names do not collide. A new service must keep that suite green.

Nothing that shells out to Docker is covered. Check those by running the stack
for real, **never against your own setup** — a reconfigure deletes generated
configs, and `container_name` is a global Docker namespace:

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

Drive it with `POST /setup/complete`, poll `GET /setup/status`. Rename only
`container_name`: published ports must stay (setup addresses services as
`localhost:<port>`) and the compose key is how containers resolve each other.

## How it Works

1. **Paths** — Choose where to store config, media, and torrents. Define media libraries (Movies, TvShows, etc.). When a host root is mounted (`STUPEFLIX_ROOT`), these are prefilled under it.
2. **Services** — Pick a torrent client, one or more media servers, and optional extras (e.g. the JOAL seeder)
3. **Credentials** — Set usernames and passwords (auto-generate available)
4. **Setup** — Review and launch. Stupeflix generates `docker-compose.yml`, starts containers, and configures each service automatically

> **Reconfigure is a reset, not an edit.** It clears exactly what the templates
> declare writing — `config_file` files plus `reset.dirs` directories — so their
> startup wizards replay. Never a list in the code. Anything no template claims is
> user data and survives: **media, JOAL's torrents, Prowlarr's indexers,
> MediaManager's database**. For one service alone, use
> `POST /services/:name/reconfigure`.

## Services

The wizard offers exactly the services defined in `templates/` — the backend
builds its registry from those files, so this list is the source of truth:

| Service | Container | Port | Category | Default | Credentials |
|---------|-----------|------|----------|:---:|-------------|
| Gluetun | `gluetun` | — | VPN | off | provider, key, address, countries |
| qBittorrent | `qbittorrent` | 8080 | Torrent Client | on | user, pass |
| Prowlarr | `prowlarr` | 9696 | Indexer | off | — |
| MediaManager | `mediamanager` | 8000 | Media Manager | off | email, pass |
| Jellyfin | `jellyfin` | 8096 | Media Server | on | user, pass |
| Plex | `plex` | 32400 | Media Server | off | claim |
| JOAL | `joal` | 6060 | Seeder | off | path, token |

**Torrent Client** and **VPN** are single-select; the others are independent
toggles. Gluetun has no port because it has no web UI — see `port` above.

A service's quirks live in its template: `notes:` for what the user must know,
which the wizard shows inline, and comments for what a maintainer must know when
bumping the image. Neither is repeated here.

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

# Merged verbatim into the generated compose file. A template may declare
# several containers (a sidecar database, say).
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

# Shown inline in the wizard and on the install screen. For what setup cannot
# do for the user. Plain sentences — rendered as text, not markdown.
notes:
  - Finish the last step in the service's own UI.

# A capability rather than a peer's name. Both optional, inert when
# unmatched — see "Networking" below.
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

# Polled and shown on the card, beyond "running". Read server-side, so the URL
# never reaches the browser; anything that fails shows as a dash.
info:
  - name: exit_ip
    label: Exit IP
    url: http://localhost:8000/v1/publicip/ip
    extract: public_ip      # dotted path into the JSON; omit to use the whole body
    refresh: 300            # seconds, default 60

# Buttons the dashboard offers after setup, POSTed to
# /services/:name/actions/:action. Declaring one is what makes it appear.
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

`actions:` **does** something and returns nothing — a button. `info:` **is**
something and does nothing — a label and a value, polled on a timer. An action
that needs to show you a result belongs in `info:`, and the reverse.

### Networking

A service routes its traffic through another's tunnel by declaring a capability,
never by naming a peer:

```yaml
# gluetun.yml                  # qbittorrent.yml
network: { provides: vpn }     network: { join: vpn }
```

Both enabled, the joiner loses its own network stack and cannot reach the
internet except through the provider — a kill switch, not a setting:

```yaml
gluetun:
  ports: ["8001:8000", "8080:8080", "6881:6881"]   # the joiner's ports move here
qbittorrent:
  network_mode: "service:gluetun"
  depends_on: { gluetun: { condition: service_healthy } }
  # none of its own: a shared namespace cannot publish
```

With no provider enabled, a `join` is inert and the block renders verbatim.

- **Host ports are unchanged**, only their owner — URLs, Open and `wait_ready` on
  `localhost:<port>` keep working.
- **A joined container loses its DNS name.** Address it with `{{host.<service>}}`,
  which follows it to the provider. Hence `http://{{host.qbittorrent}}` in
  `mediamanager.yml`.
- **A provider needs a `healthcheck`**: the joiner waits on `service_healthy`, and
  starting before the tunnel is up would leak in the clear.
- **Refused on a joiner**: `networks`, `hostname`, `links`, `dns`, `dns_search`,
  `extra_hosts`. Each belongs to the shared namespace, so moving it would change
  behaviour for the provider and every other joiner. Only `networks` is caught by
  `docker compose config`, so `src/templates.test.ts` rejects them first.

### Action icons

`icon` is optional and **case-sensitive** — an unknown name falls back to a
generic glyph rather than breaking the button, so a typo is invisible in the UI.
`src/templates.test.ts` reads the list back out of
`packages/web/src/components/ui/ActionIcon.tsx` to catch it.

| Name | Drawn as |
|------|----------|
| `refresh` | Circular arrows — the only one that spins while the action runs |
| `play` | Triangle |
| `stop` | Square |
| `power` | Power symbol |
| `download` | Arrow into a tray |
| `upload` | Arrow out of a tray |
| `trash` | Bin |
| `search` | Magnifier |
| `key` | Key — credentials |
| `open` | Arrow leaving a frame |
| `check` | Tick |
| `cog` | Gear — settings, reconfigure |

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
