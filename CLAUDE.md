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
pnpm lint             # Biome: lint + format + import sorting, both packages
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
- `id`, `name`, `description`, `category`, `defaultEnabled`, `container`
- `port`: where its web UI answers. **Optional** — a headless service (a VPN
  tunnel exposes a control API, not a UI) omits it, and the dashboard shows no
  Open link rather than a dead one
- `compose`: the compose service(s) it owns, merged verbatim into the generated file
- `generate`: secrets minted once and kept in `internal.<id>.<key>`
- `dirs` / `reset.dirs`: directories to create before boot / wipe on reconfigure
- `notes`: manual steps or quirks, shown inline in the wizard and on the
  install/reconfigure screen — where the user is configuring, not on the
  dashboard card. Plain text, rendered as-is, no markdown
- `requires` / `recommends`: what this service needs, declared as a **category**
  and never as a service name. `requires` blocks — the wizard refuses to advance
  and `POST /install/:name` answers 409; `recommends` only warns, because Sonarr
  without Prowlarr still runs and forbidding that would forbid a legitimate
  stack. Each carries the `reason` the user reads. Resolved by
  `lib/requirements.ts`, mirrored in `web/src/types/setup.ts` for live feedback —
  the API is the authority, change the two together.
  `supports: [id, …]` narrows which members of the category count, for a peer
  that is not interchangeable: Sonarr's download-client body is shaped by
  qBittorrent's settings class, so Transmission is a *different step*, not
  different values. Without it, picking Transmission would satisfy the category
  and install a Sonarr that quietly downloads nothing. It doubles as an
  editorial lock — list the combinations you have tested, and decline the rest.
  Omit it where the members really are interchangeable
- `network`: `{ provides }` lends this service's network namespace, `{ join }`
  asks for one. Neither side names the other, and an unmatched `join` is inert —
  see `lib/network.ts`
- `credentials`: fields the frontend renders in the Credentials step. Their
  `rules:` are enforced by the API (`lib/credential-rules.ts`), the wizard's copy
  being the affordance — the same arrangement `requires` has. Give a `pattern` to
  any field spliced into a document the template writes by hand (a `config_file`
  body, an `api_call` body given as a JSON *string*): the engine substitutes
  `{{...}}` and escapes for nothing, and `templates.test.ts` refuses a template
  that does not. `type` is
  `text`, `password`, `email` or `select` — a `select` carries its own `options`,
  so the wizard never learns what a VPN provider is. Use `default:` only for a
  value that is right as-is; when only the *shape* is knowable, use
  `placeholder:` — a plausible default that is wrong looks filled in, and is
  worse than an empty field
- `setup`: ordered steps. Step types:
  - `wait_ready` — polls a `url` until it responds OK. Optional `match` regex:
    keep polling until the body matches, for a service that answers before it is
    actually usable
  - `api_call` — sends a request (`url`, `method`, `body`). Optional `ignoreStatus`
    array, and `skipIf: {url, match}` to no-op when a probe shows the work is
    already done — for APIs that answer a duplicate with a second copy, not a 409.
    `merge: true` reads the resource first and lays `body` over it before sending
    the whole thing back, for an API that accepts nothing but the entire object
    on a write and whose other fields are not the template's to know
  - `config_file` — writes `content` to `file` under `paths.config`
  - `store` — keep a value that is not an API answer. `store: {from: logs|file,
    …}` is a step; `{from: body|cookie, …}` is an option on an `api_call`, since
    it reads that call's response. One vocabulary for what used to be four:
    `storeToken`+`storeAs`, `storeCookie`, and two step types that differed only
    by *where* they read. `as` is never defaulted — a session token and a
    permanent API key must not share a slot

  Any step takes `if:`, a condition (or a list of them, all of which must hold)
  that has to resolve to `"true"`. A step that will not run never enters the
  status list either, so the wizard never shows a step nobody was going to take.
  This is what makes a `recommends:` peer usable — it may be absent, and the
  steps talking to it must disappear rather than fail.

  `foreach` repeats a step over a collection, and **every option lives inside
  it** — `foreach: libraries` is shorthand for `{ source: libraries }`, while
  `type:` filters by library type and `map:` supplies per-type values as
  `{{library.<key>}}`. Nesting is deliberate: `type` means something to
  `libraries` and nothing to whatever source comes next, so it has no business in
  the vocabulary every template reads. `libraries` is the only source implemented,
  and `templates.test.ts` refuses any other — an unknown source would quietly run
  once, as if there were no loop at all
- `info`: values the dashboard polls and shows on the card — `{ name, label, url,
  extract, refresh }`. Read server-side by `lib/service-info.ts`; anything that
  fails reads as a dash, never as an error. An action *does* something and
  returns nothing, a readout *is* something and does nothing — do not merge them
- `uninstall`: `{ when, steps }` — what to undo when a **peer** is removed.
  Clean up where the entry *is*, when the thing it points at disappears: Sonarr's
  download client lives in Sonarr's database and points at qBittorrent, so only
  Sonarr's API can drop it, and qBittorrent leaving is what makes it dead.
  Removing Sonarr needs nothing — the entry goes with the database that held it.
  The id comes from `store` at creation, never from a probe at deletion
- `actions`: on-demand steps the dashboard exposes at `/services/:name/actions/:action`.
  `label` is the button's text, and optional `icon` picks its glyph from
  `web/src/components/ui/ActionIcon.tsx` — names are case-sensitive and listed in
  the README; an unknown one silently falls back to the default

A template is **root-equivalent code**: its `compose:` block reaches
`docker compose up` verbatim, and its `setup:` steps write files and call hosts.
So `lib/template-schema.ts` validates every `.yml` at load — shipped or uploaded
— and a file that will not validate is skipped and logged rather than taking the
boot down with it. It refuses the compose keys that hand over the host
(`privileged`, `pid`, `security_opt`, `network_mode`…), bounds `cap_add` to
`NET_ADMIN` and `devices` to `/dev/net/tun` and `/dev/dri` because gluetun and a
transcoding media server genuinely need those, and confines every bind-mount
source under `{{paths.*}}` — a *prefix* is not containment, so `..` in the tail
is refused too. `docs/templates.md` states the rules a template author reads.

**No file under `src/` names a service.** Adding one is dropping a `.yml` in
`templates/` and nothing else — that invariant is the point of the design, so
resist adding a service-specific branch anywhere in the API. It is also why a
dependency is expressed as a category: adding `emby.yml` satisfies Seerr's need
for a media server without either file being touched, exactly as an unmatched
`network: join` finds its provider without naming it.

Templates reach each other through variables rather than code:
`{{internal.<service>.<key>}}`, `{{credentials.<service>.<key>}}` and
`{{services.<service>.enabled}}`. That is how Sonarr picks up the API key
Stupeflix generated for Prowlarr, and how it skips the step when Prowlarr is
not installed.

`network:` is the same idea applied to topology instead of values, because a
variable can fill a string but cannot move a YAML key. A service that `join`s a
provider gives up its own network stack, so `lib/network.ts` moves its `ports`
onto the provider, sets `network_mode` and `depends_on`, and **lends the joiner's
name to the provider as a `default` network alias**. Two rules follow, and both
are enforced by `src/templates.test.ts`:

- **A joined container has no DNS name of its own — the alias gives it one
  back.** Address a peer with `{{host.<service>}}`, never by hardcoding the
  container name. That variable resolves to the service's **own** container name
  in every topology, and the alias is what makes the name answer once the
  service has joined a tunnel. The stability is the point: a peer writes that
  address once into its own database (Sonarr's download client, Seerr's Sonarr
  entry) and nothing rewrites it afterwards, so a value that changed when a
  tunnel appeared or vanished would rot every stored copy in silence — no
  `skipIf` probe would notice. It resolves in **setup steps as well as
  `compose:`**: a step wiring one service into another writes a container's view
  of a container, so `sonarr.yml` gives Sonarr `{{host.qbittorrent}}` and not
  `qbittorrent`.
- **Six keys are refused on a joiner** (`networks`, `hostname`, `links`, `dns`,
  `dns_search`, `extra_hosts`). They belong to the shared namespace, so moving
  them would change behaviour for the provider and every other joiner. Only
  `networks` is caught by `docker compose config`; the rest fail at `up`.

`config_file` steps run **before** `docker compose up` (a container reads its
config at boot); everything else runs after. The phase comes from the step type.

### Stacks (`stacks/`)

A named set of services that work together, offered above the manual list in
the wizard's Services step: `{ id, name, description, services[] }`. Loaded by
`lib/stacks.ts` and served on `GET /stacks`.

**The directory is the discriminant, not a `kind:` field.** A discriminant field
would need a list of valid values somewhere a gate can read, prose here, and a
ruling on what an absent one means; a path needs none of that and cannot hold an
invalid value.

`getStacks()` drops a stack naming a service this install does not have, so the
frontend only ever asks whether the list is empty — never why. Shipping stacks
is optional: an absent directory is an empty list, not an error.

`templates.test.ts` proves each stack names real services and leaves no
`requires` unmet. That is what lets the stack path in the wizard skip the alert
region entirely.

### API (`packages/api/`)

```
src/
├── index.ts              # Bootstrap only - load templates, open the DB, listen
├── app.ts                # The whole HTTP surface, assembled; testable without a port
├── db.ts                 # sql.js SQLite wrapper (per-service defaults come from templates)
├── lib/
│   ├── env.ts            # Runtime config (paths, service host, PUID/PGID/TZ) from env vars
│   ├── auth.ts           # The access token, and the gate in front of every route
│   ├── docker-cli.ts     # `docker` as an argv array — the one place, and no shell
│   ├── container-status.ts # One `docker ps` for every container, memoised ~1s
│   ├── template-vars.ts  # Builds and resolves {{...}} — the only place vars are defined
│   ├── template-schema.ts # What a `.yml` must be before it becomes root-equivalent code
│   ├── service-registry.ts # Loads YAML templates, mints secrets, runs setup steps
│   ├── setup-runner.ts   # Phases (pre_up/post_up), foreach expansion, step statuses
│   ├── compose.ts        # Merges the enabled templates' `compose:` blocks
│   ├── network.ts        # provides/join topology, and the compose rewrite it implies
│   ├── requirements.ts   # requires/recommends resolved by category, never by name
│   ├── credential-rules.ts # The `rules:` a template declares, enforced server-side
│   ├── safe-path.ts      # join + the proof it did not climb out; the wizard's paths
│   ├── service-url.ts    # The hosts a template may name, and the localhost rewrite
│   ├── instance.ts       # Which database owns the containers — labels + the guard
│   ├── stacks.ts         # stacks/*.yml — a named set of services, loaded like templates
│   ├── service-install.ts # Install / reconfigure / remove one service
│   ├── library-stats.ts  # Counts each library off the filesystem, plus disk
│   ├── service-info.ts   # Reads a template's `info:` readouts off the service
│   ├── helpers.ts        # Media/template dirs, reconfigure reset (global + scoped)
│   └── logger.ts         # Logging utility
└── routes/
    ├── setup.ts          # /setup/* routes (async setup, status)
    ├── install.ts        # /install/:name — one service, same runner
    ├── settings.ts       # /settings/* routes
    ├── docker.ts         # /docker/* routes
    └── services.ts       # /services/* routes, incl. reconfigure and DELETE
```

**Every route needs a bearer token**, except `GET /health` — the healthcheck
polls it from outside the app and has no way to carry one. The gate is mounted on
the `api` router, not the outer app, and `app.ts` mounts `api` at the root *only*
when nothing else is served on the port: `api.use("*")` matches every path,
including the ones `api` has no route for, so a root mount in front of
`serveStatic` answers 401 for the wizard's own `index.html`.

The token is minted on first boot and kept in the database, or pinned by
`STUPEFLIX_TOKEN`. A pinned one is checked at boot against what an
`Authorization` header can carry, and the server refuses to start rather than
start unreachable.

`POST /setup/preview` answers what a configuration *would* run — the same keys
and labels the status endpoint will serve — computed against a read-only overlay
of the database. It writes nothing on purpose: the summary screen it feeds is one
the user can still back out of, and those keys are what the dashboard reads to
decide what is installed.

`GET /setup/status` returns `steps` **and `labels`** — the label each template
declares for the step. The frontend has no other way to learn that `create_user`
is "Create admin user"; deriving it from the key gave "Create User".

A step whose `skipIf` probe finds the work already done is recorded `skipped`,
not `completed`. It counts as done everywhere, but the two are not the same
event: reporting a skip as a success is what let a stale peer hide behind a green
tick, with no request ever sent. `runSetupStep` returns the `SKIPPED` symbol for
it — checked before the truthiness test, since a symbol is truthy.

`setup.ts` drives `setup-runner.ts` directly; installing, reconfiguring and
removing **one** service all go through `lib/service-install.ts`. Keep that
orchestration there rather than duplicating it into a route — a first install and
a reconfigure must never drift apart, which is why they are one function with a
`reset` flag.

Two invariants that are easy to break:

- **A reset is scoped.** `cleanConfigs` clears every template, `cleanServiceConfig`
  clears one. Reconfiguring Jellyfin must not replay Plex's startup wizard, so use
  the per-template lists (`getTemplateConfigFiles`, `getTemplateResetDirs`).
- **A reset directory is emptied, never replaced.** It is bind-mounted into the
  container, and a mount attaches to the directory itself rather than to its
  name — `rm -rf` then `mkdir` puts a different object at the same path, and
  Docker Desktop hands the container the deleted one. Jellyfin then boots unable
  to create `/config/data` and `wait_ready` times out four minutes later on an
  API that will never answer. `helpers.test.ts` asserts the inode survives.
- **Removal never names a container.** A template may own several (a service and
  its database, say), so it disables the service, rewrites the compose file
  and lets `up -d --remove-orphans` collect what is no longer declared. The
  service's directory under `paths.config` is deliberately kept.

### Tests (`pnpm test`)

Vitest, colocated as `src/**/*.test.ts`. Fixture templates live in
`src/test/fixtures/` so the engine is exercised without touching the real ones.

`src/templates.test.ts` is the important one: it runs against the **real**
`templates/` directory and asserts what the code no longer can — that every
`{{...}}` reference resolves, that `container_name` matches `container`, that
compose service names and host ports do not collide, that a peer is addressed
through `{{host.x}}` rather than by container name (in `compose:`, `setup:`,
`actions:` and `info:` alike), that every `requires`/`recommends` category is one
some template provides, and that every `foreach` source is one the runner implements. **A new service
template must keep it green** — that suite is what replaces the per-service code
that used to exist.

Those last two are gates against silent no-ops rather than crashes: a category
nobody provides blocks the wizard on a box the user cannot tick, and an unknown
`foreach` source runs the step once as if it had no loop. Neither raises.

There is no test for the docker-facing paths (`compose up`, `rm --remove-orphans`,
live service APIs) — which now includes reconfiguring and removing a service.
Changes there need a real run: see the isolated recipe in the README, and never
against a live stack. That recipe works, and it is worth the trouble: it is what
caught `priority` being a top-level field of Sonarr's download client rather than
one of its `fields[]`, which no amount of reading the API docs had revealed.

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
│   ├── steps/        # PathsStep, CredentialsStep, ServicesStep, ProgressStep,
│   │             #   StepMatrix, SetupPreflight
│   └── ui/           # Button, Input, Select, Toggle, StatusBadge, ActionIcon
└── types/setup.ts    # TypeScript interfaces
```

### Running inside a container

The API shells out to `docker` and writes service configs on the host filesystem,
so everything path- or host-related goes through `lib/env.ts`:

- Host paths must be identical inside and outside the container — hence the single
  `STUPEFLIX_ROOT` bind mount, which also prefills the wizard (`GET /runtime`).
- Service containers publish on the host, so template URLs (`http://localhost:8096`)
  are rewritten to `STUPEFLIX_SERVICE_HOST` by `serviceUrl()`.
- Never call `docker` directly, and never build a command as a string: use
  `runCompose` / `runComposeSync` / `runDockerSync` from `lib/docker-cli.ts`.
  They pin `-f <generated file>` and the project name, and they take an **argv
  array** through `execFile` — no shell is involved anywhere in that module, so
  a container name or a `--tail` value cannot end one command and start another.
  That property is why the module exists; a string built at a call site loses it.
- The compose project is always `stupeflix`, never derived from the working
  directory: running from source and running the image must own the same
  containers, or they collide on `container_name`.
- Which is why ownership is the **database**, not the directory — and Docker
  records no such thing. `lib/instance.ts` writes it: every generated service
  carries `com.stupeflix.instance` (an id minted once in the DB) and
  `com.stupeflix.db` (its path, for the message). `ownershipConflict()` reads
  those back before an install, reconfigure, removal or setup, and the route
  answers 409 having changed nothing. Two instances on the same `data/` agree
  and proceed; two on different ones are stopped — otherwise a removal here
  collects the other's services as orphans and deletes them. A container with
  no label predates the check and is adopted, then stamped by the next `up`.
- The compose file lives next to the database (`data/`), so pointing an image at
  the dev server's `data/` directory shares the whole state.

## Key Files

- `docs/adr/` - Decisions that shape the rest, and what each makes unnecessary.
  Read these before reversing something that looks like an oversight — the bearer
  token, the missing `csrf()`, the root `USER`, the argv-only Docker layer
- `templates/*.yml` - Service definitions (credentials, setup pipeline)
- `packages/api/src/lib/service-registry.ts` - Template loader and setup step runner
- `packages/api/src/routes/setup.ts` - Async setup with status polling
- `packages/web/src/components/Wizard.tsx` - Setup wizard UI (fetches registry from API)
- `docker-compose.yml` - Generated container definitions

## UI Conventions

- All user-facing text must be in English
- UI components: Button, Input, Select, Toggle, StatusBadge, RadioGroup,
  Accordion, ActionIcon, ServiceIcon (`packages/web/src/components/ui/`)
- **Colours come from `tailwind.config.js`, never Tailwind's stock greys.**
  `brand` is the logo's neon rose; `ink` is three grounds — `950` page, `900`
  panel, `800` card, `700` icon tile. Edges are white-alpha hairlines
  (`border-white/[0.07]`, `/[0.12]`), not solid greys: a grey line on a dark
  ground muddies everything.
- Changing `tailwind.config.js` needs a dev-server restart — Vite does not pick it
  up hot, and `@apply` with a new token fails the PostCSS build until it does.
- **Anything that opens or closes uses `ui/Collapse`.** It measures its content
  and animates to that height through the Web Animations API. Both shortcuts
  were tried and both fail: a `max-height` cap crosses space the content never
  occupies and snaps at the end, and `grid-template-rows: 1fr → 0fr` starts no
  animation at all — the collapse it produced only looked smooth because an
  opacity fade ran beside it. Never hide the box with `visibility: hidden`
  either: an element that is not rendered cannot animate, so the closed state is
  zero height plus `inert`.
- Service logos come from **[dashboardicons.com](https://dashboardicons.com)**,
  which carries every self-hosted app in this stack; simple-icons has the
  monochrome marks for a few (Sonarr, Radarr). Anything else — a category, an
  action — comes from Heroicons outline paths. Hand-drawn SVG reads as noise at
  the 14px these render at.
- **`currentColor` decides the tile.** A monochrome glyph takes the service's
  hue, a full-colour logo gets a neutral tile instead — Prowlarr's orange on a
  green tile reads as a mistake, and `serviceTint` detects which it is by
  looking for `currentColor` in the file. **Take dashboardicons' monochrome
  variant** and give its root `fill="currentColor"`: Prowlarr's colour
  illustration weighed 11 kB and turned to mush at 20px, its mono mark is 3 kB
  and takes the tint.
- **A service's glyph is a file, not code**: `web/src/assets/icons/<id>.svg`,
  found by filename. `ServiceIcon` globs the directory at build time, so adding a
  service is dropping its `.svg` beside the others and touching nothing else —
  the same invariant the API holds for `templates/`. Author it with
  `fill="currentColor"` or `stroke="currentColor"` so the tile's tint reaches it,
  and `ServiceIcon` falls back to `_default.svg` for a service that has none —
  a template dropped into a running install must never fail on a missing glyph.
  The gate runs the other way only: `templates.test.ts` fails on an icon whose
  template is gone, since nothing else would ever point that file out. Names
  starting with `_` are the frontend's own and are exempt.

## Linting Rules (`pnpm lint`)

Biome, configured once at the root in `biome.json` and covering both packages —
lint, formatter and import sorting in a single pass:

```bash
pnpm lint       # biome check .   — the gate; must be green before "done"
pnpm lint:fix   # biome check --write .
```

On top of `recommended`, five rules are named explicitly because they are the
contract this codebase is written to: `noExplicitAny`, `noUnusedVariables`,
`noUnusedImports`, `useConst`, `noVar` — all errors.

Formatting is Biome's default (tabs, double quotes, 80 columns). The whole repo
conforms; there is no second style.

**When the gate refuses something the code means on purpose, suppress it at the
site, never in `biome.json`.** A `biome-ignore` carries a reason and stays next
to the thing it excuses; a rule switched off in the config silently excuses code
nobody has read yet. The directive must be the *last* comment line before the
offending line — explanation above it, one-line reason on the directive. There
are five today (`lib/network.ts`, `PathsStep.tsx`, `ServicesStep.tsx`).

`src/templates.test.ts` reads `web/src/components/ui/ActionIcon.tsx` as data to
check every `icon:` a template names. Its regex is indentation-agnostic on
purpose — a formatter run must not be able to turn that assertion into a no-op.
