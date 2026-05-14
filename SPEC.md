# SPEC.md - Stupeflix

## Overview

API-first orchestrator for a self-hosted media stack. Monorepo with backend API and frontend wizard.

## Monorepo Structure

```
stupeflix/
├── packages/
│   ├── api/                    # Backend Hono API
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── db.ts
│   │   │   ├── lib/
│   │   │   │   ├── compose.ts
│   │   │   │   ├── configs.ts
│   │   │   │   ├── prowlarr.ts
│   │   │   │   ├── helpers.ts
│   │   │   │   └── logger.ts
│   │   │   └── routes/
│   │   │       ├── setup.ts
│   │   │       ├── settings.ts
│   │   │       ├── docker.ts
│   │   │       └── services.ts
│   │   ├── migrations/
│   │   └── package.json
│   │
│   └── web/                    # Frontend React Wizard
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── api/
│       │   │   └── client.ts
│       │   ├── hooks/
│       │   │   └── useSetupStatus.ts
│       │   ├── components/
│       │   │   ├── Wizard.tsx
│       │   │   ├── StepIndicator.tsx
│       │   │   ├── steps/
│       │   │   │   ├── PathsStep.tsx
│       │   │   │   ├── CredentialsStep.tsx
│       │   │   │   ├── ServicesStep.tsx
│       │   │   │   └── ProgressStep.tsx
│       │   │   └── ui/
│       │   │       ├── Input.tsx
│       │   │       ├── Toggle.tsx
│       │   │       ├── Button.tsx
│       │   │       └── StatusBadge.tsx
│       │   └── types/
│       │       └── setup.ts
│       ├── index.html
│       └── package.json
│
├── pnpm-workspace.yaml
├── package.json                # Root scripts
├── docker-compose.yml          # Generated
├── data/                       # SQLite DB
└── assets/                     # Flood UI
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| Stupeflix API | 3000 | Orchestrator backend |
| Stupeflix Web | 5173 | Setup wizard frontend |
| MediaManager | 8000 | Media management |
| Jellyfin | 8096 | Media streaming |
| Transmission | 9091 | Torrent client (Flood UI) |
| Prowlarr | 9696 | Indexer manager |
| Ygege | 8715 | YGG torrent indexer |
| FlareSolverr | 8191 | Cloudflare bypass |

## API Endpoints

### Setup

```
POST /setup/complete
  ← {
      "paths": { "config": "...", "media": "...", "torrents": "..." },
      "credentials": {
        "transmission": { "user": "...", "pass": "..." },
        "mediamanager": { "email": "...", "pass": "..." },
        "indexers": { "ygg": { "username": "...", "password": "..." } }
      },
      "services": {
        "mediamanager": { "enabled": true },
        "jellyfin": { "enabled": true },
        ...
      }
    }
  → { "success": true, "message": "Setup started" }

GET /setup/status
  → {
      "global": "in_progress",
      "steps": {
        "compose": "completed",
        "containers": "in_progress",
        "prowlarr": "pending",
        "ygege": "pending",
        "flaresolverr": "pending",
        "mediamanager": "pending"
      },
      "error": null
    }
```

### Settings

```
GET /settings           → All settings
PUT /settings           → Bulk update
GET /settings/:key      → Single setting
PUT /settings/:key      → Update single
DELETE /settings/:key   → Delete
```

### Services

```
GET /services                    → List with status
POST /services/:name/start
POST /services/:name/stop
POST /services/:name/restart
GET /services/:name/logs?lines=100
```

### Docker

```
POST /docker/generate   → Generate docker-compose.yml
POST /docker/up         → docker compose up -d
POST /docker/down       → docker compose down
POST /docker/pull       → docker compose pull
```

## Auto-Configuration

### Prowlarr
- Wait for config.xml
- Extract API key
- Download ygege.yml definition to `Definitions/Custom/`
- Wait for Ygege authentication (`/status` → `auth: "authenticated"`)
- Configure Ygege indexer
- Configure FlareSolverr proxy

### MediaManager
- Configure Transmission connection (host: `transmission`)
- Configure Prowlarr integration (host: `prowlarr`, API key)
- Register admin user via `/api/v1/auth/register`

### Transmission
- Configure credentials
- Install Flood web UI

## Frontend Wizard

### Stack
- React 19
- TypeScript
- Vite
- TailwindCSS
- React Query (polling)
- Zustand (state)

### Steps

| Step | Component | Fields |
|------|-----------|--------|
| 1 | PathsStep | config, media, torrents |
| 2 | CredentialsStep | transmission, mediamanager, ygg |
| 3 | ServicesStep | toggles for each service |
| 4 | ProgressStep | real-time status + completion |

### Flow

```
[Paths] → [Credentials] → [Services] → POST /setup/complete
                                              ↓
                                       [ProgressStep]
                                              ↓
                                       Polling /setup/status
                                              ↓
                                       [Done] or [Error]
```

### Types

```typescript
interface SetupConfig {
  paths: {
    config: string;
    media: string;
    torrents: string;
  };
  credentials: {
    transmission: { user: string; pass: string };
    mediamanager: { email: string; pass: string };
    indexers: { ygg: { username: string; password: string } };
  };
  services: Record<string, { enabled: boolean }>;
}

interface SetupStatus {
  global: "pending" | "in_progress" | "completed" | "failed";
  steps: Record<string, "pending" | "in_progress" | "completed" | "failed">;
  error: string | null;
}

type StepId = "paths" | "credentials" | "services" | "progress";
```

### Components

```tsx
// Wizard.tsx - Main container
const Wizard = () => {
  const [step, setStep] = useState<StepId>("paths");
  const [config, setConfig] = useState<SetupConfig>(defaultConfig);

  return (
    <div>
      <StepIndicator current={step} />
      {step === "paths" && <PathsStep />}
      {step === "credentials" && <CredentialsStep />}
      {step === "services" && <ServicesStep />}
      {step === "progress" && <ProgressStep />}
    </div>
  );
};

// ProgressStep.tsx - Real-time status
const ProgressStep = () => {
  const { data: status } = useQuery({
    queryKey: ["setup-status"],
    queryFn: () => api.getStatus(),
    refetchInterval: (data) =>
      data?.global === "in_progress" ? 2000 : false,
  });

  return (
    <div>
      {STEPS.map(step => (
        <StatusBadge key={step} status={status?.steps[step]} />
      ))}
      {status?.global === "completed" && <SuccessMessage />}
      {status?.global === "failed" && <ErrorMessage error={status.error} />}
    </div>
  );
};
```

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch())
);
```

### Default Keys

```
paths.config
paths.media
paths.torrents
credentials.transmission.user
credentials.transmission.pass
credentials.mediamanager.email
credentials.mediamanager.pass
credentials.indexers.ygg.username
credentials.indexers.ygg.password
services.mediamanager.enabled
services.jellyfin.enabled
services.transmission.enabled
services.flaresolverr.enabled
services.prowlarr.enabled
services.ygege.enabled
setup.completed
setup.global
setup.status.*
setup.error
```

## Scripts

```bash
# Root
pnpm install          # Install all packages
pnpm dev              # Run api + web in parallel
pnpm build            # Build all

# API
pnpm --filter api dev
pnpm --filter api build

# Web
pnpm --filter web dev
pnpm --filter web build
```

## Environment

```bash
DEBUG=true            # Enable debug logging
```
