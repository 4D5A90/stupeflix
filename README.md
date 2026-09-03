# Stupeflix

- [Quick Start](#quick-start-docker)
  - [Windows](#windows)
  - [Alternating between the image and `pnpm dev`](#alternating-between-the-image-and-pnpm-dev)
- [Development](#development)
  - [Tests](#tests)
- [How it Works](#how-it-works)
- [Services](#services)
- [Media Libraries](#media-libraries)
- [Service Templates](#service-templates)
  - [Step types](#step-types)
  - [Actions and readouts](#actions-and-readouts)
  - [Networking](#networking)
  - [Action icons](#action-icons)
  - [Template variables](#template-variables)
  - [`foreach: libraries`](#foreach-libraries)
  - [`api_call` options](#api_call-options)
  - [Credential field rules](#credential-field-rules)
- [API](#api)
- [Stack](#stack)

## Quick Start (Docker)

Only Docker is required. The image builds the API and the wizard itself.

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

`--add-host` is Linux-only. Docker Desktop and OrbStack provide
`host.docker.internal`. For another host directory, change both sides of the mount
and pass `-e STUPEFLIX_ROOT=/your/path`.

### Windows

Run it from **inside WSL 2** the Linux Quick Start then works verbatim. Keep
`STUPEFLIX_ROOT` on the WSL 2 filesystem, **not** under `/mnt/c/...`: the daemon
resolves that path a second time when creating the service containers, which only
works for Linux paths it sees natively.

From **PowerShell** or **Git Bash**: double the socket's leading slash
(`-v //var/run/docker.sock:...`), one line only (`` ` `` continues in PowerShell,
`^` in cmd), drop `--add-host`, and run the dev-sharing command from WSL 2.

### Alternating between the image and `pnpm dev`

Both use the project `stupeflix`, so neither steals the other's containers. To
share credentials and setup state too, point `/data` at the dev server's:

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

Mismatched `PUID`/`PGID` rewrites the compose file on every switch, recreating
every container.

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

Open `http://localhost:5173`. Vite proxies `/api` to the API on 3000. In the
image, the API serves the built wizard on the same port.

### Tests

```bash
pnpm test          # vitest, api package
```

They cover the engine and, in `src/templates.test.ts`, the real `templates/`
directory: variables resolve, `container_name` matches `container`, ports do not
collide. A new service must keep that green. Nothing that shells out to Docker is
covered, so check `compose up`, reconfigure and remove by running a throwaway
copy of the stack, **never your own**: a reconfigure deletes generated
configs and `container_name` is a global Docker namespace:

```bash
# container_name only: ports are how setup steps reach services, and compose
# keys how containers reach each other
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

This starts the API alone, so drive it with `POST /setup/complete` and poll
`GET /setup/status`.

## How it Works

1. **Paths**: config, media, torrents, and your libraries. Prefilled under
   `STUPEFLIX_ROOT` when a host root is mounted.
2. **Services**: a torrent client, media servers, optional extras.
3. **Credentials**: usernames and passwords, auto-generate available.
4. **Setup**: generates `docker-compose.yml`, starts the containers, configures
   each service.

## Services

The wizard offers exactly the services defined in `templates/`. The backend
builds its registry from those files, so this list is the source of truth:

| Service | Container | Port | Category | Default | Credentials |
|---------|-----------|------|----------|:---:|-------------|
| Gluetun | `gluetun` | none | VPN | off | provider, key, address, countries |
| qBittorrent | `qbittorrent` | 8080 | Torrent Client | on | user, pass |
| Prowlarr | `prowlarr` | 9696 | Indexer | off | none |
| Sonarr | `sonarr` | 8989 | Media Manager | off | none |
| Radarr | `radarr` | 7878 | Media Manager | off | none |
| Jellyfin | `jellyfin` | 8096 | Media Server | on | user, pass |
| Plex | `plex` | 32400 | Media Server | off | claim |
| Seerr | `seerr` | 5055 | Requests | off | email |
| JOAL | `joal` | 6060 | Seeder | off | path, token |


## Stacks

A stack is a named set of services that work together — the shortcut past
choosing ten things one by one. They live in `stacks/`, are loaded like
templates and served on `GET /stacks`:

```yaml
# stacks/household.yml
id: household
name: Household
description: Everyone asks from their phone, it downloads itself
services: [qbittorrent, prowlarr, sonarr, radarr, jellyfin, seerr]
```

The directory is the discriminant — a file in `stacks/` is a stack the way a
file in `templates/` is a service. No `kind:` field, so nothing to describe,
nothing to forget, and no default to rule on for the templates that predate it.

`src/templates.test.ts` asserts every stack names services that exist and leaves
no `requires` unmet. That proof is what lets the wizard offer a stack with no
warnings attached: an unusable combination cannot ship as a one-click
recommendation.

Shipping them is optional. An absent directory, an empty one, or one whose
stacks all name a missing service arrive the same way — an empty list — and the
Services step simply offers no fork.

## Media Libraries

Libraries are defined in the first step of the wizard (under Media Path). Each library has a name and a type (`movies`, `tvshows`, or `music`). Default: Movies + TvShows.

During setup, Stupeflix automatically:
- Creates the folders on disk
- Creates matching libraries in each enabled media server (Jellyfin, Plex, etc.)
- Creates matching download categories in the torrent client (qBittorrent, etc.)

## Service Templates

A template owns **everything** about its service: container, files, setup
pipeline, dashboard actions. No file under `packages/api/src` names a service, so
adding one is dropping a `.yml` in `templates/` and nothing else.

```yaml
id: myservice
name: My Service
description: What it does
category: mediaServer
defaultEnabled: false
container: myservice        # compose service name, and the container_name below
port: 8080                  # its web UI; omit it for a headless service

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
# do for the user. Plain sentences, rendered as text, not markdown.
notes:
  - Finish the last step in the service's own UI.

# A capability rather than a peer's name. Both optional, inert when
# unmatched. See "Networking" below.
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

Any step may carry `if:` — a template expression that has to resolve to `true`
for the step to run. A step that does not run never appears in the status list
either, so the wizard does not display a step nobody was going to take:

```yaml
- name: register_in_prowlarr
  type: api_call
  if: "{{services.prowlarr.enabled}}"
```

A list means every condition has to hold — wiring two services together needs
both of them:

```yaml
  if:
    - "{{services.jellyfin.enabled}}"
    - "{{services.sonarr.enabled}}"
```

That is what makes an optional peer usable: a `recommends:` service may well be
absent, and the steps that talk to it have to disappear rather than fail.

`config_file` steps run **before** `docker compose up`, since a container reads
its config at boot; every other step runs after. That ordering is derived from
the step type, not declared.

### Actions and readouts

`actions:` **does** something and returns nothing: a button. `info:` **is**
something and does nothing: a label and a value, polled on a timer. An action
that needs to show you a result belongs in `info:`, and the reverse.

### Requirements

A template can declare what it needs, by **category** and never by name:

```yaml
requires:
  - category: torrentClient
    reason: Sonarr hands every download to a torrent client — install one first.
recommends:
  - category: indexer
    reason: Without an indexer, Sonarr has nothing to search.
```

`requires:` blocks — the wizard refuses to move on, and `POST /install/:name`
answers 409. `recommends:` only warns: Sonarr without Prowlarr still runs, its
owner just adds trackers by hand, and forbidding that would forbid a legitimate
stack. The `reason` is what the user reads, so write it as a sentence.

`supports:` narrows which members of the category count:

```yaml
requires:
  - category: torrentClient
    supports: [qbittorrent]
    reason: Sonarr hands every download to a torrent client — install one first.
```

Use it when the wiring is not interchangeable. Sonarr's download-client step
sends a qBittorrent-shaped body whose field names come from the settings class
its API names, so another client is not different values — it is a different
step. Until that step exists, `supports:` makes the wizard say so instead of
installing a service that would quietly download nothing.

It is also how a template declines a peer deliberately: list the combinations
you have actually tested, and the ones too complex or too poorly maintained to
carry simply never validate. Omit it where the members really are
interchangeable — any media server will do behind Seerr.

The message differs by case, because the fix does. Nothing of that kind
installed at all gives you the template's `reason`; the wrong one installed
gives a generated line naming both, since a template cannot guess which peer
someone would pick.

Depending on a category rather than a service is what keeps the rule general:
adding `emby.yml` satisfies Seerr's need for a media server without either file
being touched — the same reason `network:` matches a `join` to a `provides`.

### Networking

A service routes its traffic through another's tunnel by declaring a capability,
never by naming a peer:

```yaml
# gluetun.yml                  # qbittorrent.yml
network: { provides: vpn }     network: { join: vpn }
```

Both enabled, the joiner loses its own network stack and cannot reach the
internet except through the provider. A kill switch, not a setting:

```yaml
gluetun:
  ports: ["8001:8000", "8080:8080", "6881:6881"]   # the joiner's ports move here
qbittorrent:
  network_mode: "service:gluetun"
  depends_on: { gluetun: { condition: service_healthy } }
  # none of its own: a shared namespace cannot publish
```

With no provider enabled, a `join` is inert and the block renders verbatim.

- **Host ports are unchanged**, only their owner, so URLs, Open and `wait_ready` on
  `localhost:<port>` keep working.
- **A joined container loses its DNS name.** Address it with `{{host.<service>}}`,
  which follows it to the provider. Hence `http://{{host.qbittorrent}}` in
  `sonarr.yml`. It resolves in **setup steps as well as `compose:`** — a
  step wiring one service into another writes a container's view of a container,
  so `sonarr.yml` hands Sonarr `{{host.qbittorrent}}`, not `qbittorrent`.
- **A provider needs a `healthcheck`**: the joiner waits on `service_healthy`, and
  starting before the tunnel is up would leak in the clear.
- **Refused on a joiner**: `networks`, `hostname`, `links`, `dns`, `dns_search`,
  `extra_hosts`. Each belongs to the shared namespace, so moving it would change
  behaviour for the provider and every other joiner. Only `networks` is caught by
  `docker compose config`, so `src/templates.test.ts` rejects them first.

### Action icons

`icon` is optional and **case-sensitive**. An unknown name falls back to a
generic glyph rather than breaking the button, so a typo is invisible in the UI.
`src/templates.test.ts` reads the list back out of
`packages/web/src/components/ui/ActionIcon.tsx` to catch it.

| Name | Drawn as |
|------|----------|
| `refresh` | Circular arrows; the only one that spins while the action runs |
| `play` | Triangle |
| `stop` | Square |
| `power` | Power symbol |
| `download` | Arrow into a tray |
| `upload` | Arrow out of a tray |
| `trash` | Bin |
| `search` | Magnifier |
| `key` | Key, for credentials |
| `open` | Arrow leaving a frame |
| `check` | Tick |
| `cog` | Gear, for settings and reconfigure |

### Template variables

| Variable | Source |
|----------|--------|
| `{{credentials.key}}` | Credential values from the wizard |
| `{{internal.key}}` | Generated secrets, and values stored by previous steps (tokens, passwords) |
| `{{paths.config}}` `{{paths.media}}` `{{paths.torrents}}` | Host paths from the wizard |
| `{{env.PUID}}` `{{env.PGID}}` `{{env.TZ}}` | Host wiring |
| `{{host.<service>}}` | The container another service must be addressed by, in `compose:` and in setup steps; see Networking |
| `{{library.name}}` | Library folder name (in `foreach: libraries` steps) |
| `{{library.type}}` | Library type: `movies`, `tvshows`, `music` |
| `{{libraries.<type>_json}}` | All libraries of a type as `[{"name":…,"path":"/media/…"}]` |
| `{{internal.<service>.<key>}}` | **Another** service's secret |
| `{{credentials.<service>.<key>}}` | **Another** service's credential |
| `{{services.<service>.enabled}}` | `"true"` / `"false"` |

The last three connect two services without touching either's code. Sonarr
reads `{{internal.prowlarr.api_key}}`. An entry resolving to empty (`FOO=`) is
dropped from the compose file, so a blank optional credential falls back to the
image's default instead of shadowing it.

### `foreach`

Repeats a step over a collection. `libraries` is the only source so far, and
`foreach: libraries` is shorthand for `foreach: { source: libraries }`:

```yaml
- name: add_library
  type: api_call
  foreach: libraries
  url: http://localhost:8096/Library/VirtualFolders?name={{library.name}}
```

Every option lives **inside** `foreach`, never beside it. `type` means something
to `libraries` and would mean nothing to whatever source comes next, so it has no
business in the vocabulary every template has to read — and nesting also makes a
filter with no loop impossible to write.

`type` keeps only the libraries of one kind; Sonarr has no business being handed
a Movies folder:

```yaml
- name: root_folder
  type: api_call
  foreach:
    source: libraries
    type: tvshows
  body:
    path: "/media/{{library.name}}"
```

`map` supplies per-type values, injected as `{{library.<key>}}`:

```yaml
- name: add_library
  type: api_call
  foreach:
    source: libraries
    map:
      movies:
        content_type: movie
        agent: tv.plex.agents.movie
      tvshows:
        content_type: show
        agent: tv.plex.agents.series
  url: http://localhost:32400/library/sections?type={{library.content_type}}&agent={{library.agent}}
  method: POST
```

A step naming a source the runner does not implement would quietly run once, as
if it had no loop — `src/templates.test.ts` fails on it instead.

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
| `merge: true` | Read the resource first and lay `body` over it, then send the whole thing back (shallow, by top-level key) |

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
| GET | `/stacks` | List the stacks this install can offer |
| GET | `/services` | List services with status |

## Stack

- **Backend**: Hono + sql.js + YAML templates
- **Frontend**: React + Vite + TailwindCSS + React Query
