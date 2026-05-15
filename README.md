# Stupeflix

![stupeflix](https://github.com/user-attachments/assets/c85b1227-8c29-4b24-aba0-d9df7f94dd1c)

Self-hosted media stack orchestrator with a web-based setup wizard.

## Prerequisites

- Node.js
- pnpm (`npm install --global pnpm`)
- Docker & Docker Compose

## Quick Start

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173` and follow the setup wizard.

## How it Works

1. **Paths** — Choose where to store config, media, and torrents. Define media libraries (Movies, TvShows, Anime, etc.)
2. **Services** — Pick a torrent client, one or more media servers, and optional services
3. **Credentials** — Set usernames and passwords (auto-generate available)
4. **Setup** — Review and launch. Stupeflix generates `docker-compose.yml`, starts containers, and configures each service automatically

## Services

| Service | Port | Category | Multi-select |
|---------|------|----------|:---:|
| Jellyfin | 8096 | Media Server | Yes |
| Plex | 32400 | Media Server | Yes |
| Emby | 8096 | Media Server | Yes |
| qBittorrent | 8080 | Torrent Client | No |
| Transmission | 9091 | Torrent Client | No |
| MediaManager | 8000 | Media Manager | Yes |

Media servers can be enabled simultaneously. Torrent client is single-select.

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

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/status` | Setup state + container status |
| GET | `/registry` | Service definitions for the frontend |
| GET | `/templates` | List loaded template files |
| POST | `/templates/reload` | Reload templates from disk |
| POST | `/templates/upload` | Upload a new template |
| POST | `/setup/complete` | Start setup |
| GET | `/setup/status` | Track setup progress |
| GET | `/credentials` | Get stored credentials |
| GET | `/services` | List services with status |

## Stack

- **Backend**: Hono + sql.js + YAML templates
- **Frontend**: React + Vite + TailwindCSS + React Query
