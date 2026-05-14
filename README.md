# Stupeflix

![stupeflix](https://github.com/user-attachments/assets/c85b1227-8c29-4b24-aba0-d9df7f94dd1c)

Self-hosted media stack orchestrator with a web-based setup wizard.

## Prerequisites

- Node.jss
- pnpm (`npm install --global pnpm`)
- Docker & Docker Compose

## Quick Start

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5173` and follow the setup wizard.

## How it Works

1. **Paths** — Choose where to store config, media, and torrents
2. **Services** — Pick a torrent client, media server, and optional services
3. **Credentials** — Set usernames and passwords (auto-generate available)
4. **Setup** — Review and launch. Stupeflix generates `docker-compose.yml`, starts containers, and configures each service automatically

## Services

| Service | Port | Category |
|---------|------|----------|
| Jellyfin | 8096 | Media Server |
| Plex | 32400 | Media Server |
| Emby | 8096 | Media Server |
| qBittorrent | 8080 | Torrent Client |
| Transmission | 9091 | Torrent Client |
| MediaManager | 8000 | Media Manager |

Services are defined as YAML templates in `templates/`. Add new services by dropping a `.yml` file — no code changes needed.

## Service Templates

Each service is declared in a YAML file:

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
| `api_call` | HTTP request with template variables, retry, cookies, tokens |
| `config_file` | Handled by imperative code in `configs.ts` |
| `extract_from_logs` | Extract a value from container logs via regex |

### Template variables

Use `{{credentials.key}}` to reference credential values and `{{internal.key}}` for values stored by previous steps (e.g., extracted tokens).

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
