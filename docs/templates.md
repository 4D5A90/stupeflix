# Writing a service template

A template owns everything about its service: container, files, setup pipeline,
dashboard actions. Drop a `.yml` in [`templates/`](../templates), keep `pnpm test`
green, and it appears in the wizard. No file under `packages/api/src` names a service.

[Anatomy](#anatomy) ·
[Setup steps](#setup-steps) ·
[Requirements](#requirements) ·
[Networking](#networking) ·
[Variables](#variables) ·
[`foreach`](#foreach) ·
[`api_call` options](#api_call-options) ·
[Credential rules](#credential-rules) ·
[What a template may declare](#what-a-template-may-declare) ·
[The service logo](#the-service-logo) ·
[Action icons](#action-icons)

## Anatomy

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

# Shown in the wizard and on the install screen, for what setup cannot do for
# the user. Plain sentences, rendered as text, not markdown.
notes:
  - Finish the last step in the service's own UI.

# A capability, never a peer's name. Optional and inert when unmatched.
network:
  join: vpn

dirs:                # created under paths.config before the container boots
  - myservice/cache

# Named volumes the services above reference. Reserved for storage an engine
# owns and nobody opens by hand — a PGDATA, a Redis AOF. Docker owns their
# permissions, which is what makes them immune to a PUID that does not match
# the image's user. Everything a human reads, edits or backs up stays a bind
# mount under paths.config: a named volume is invisible from the host, absent
# from a backup of STUPEFLIX_ROOT, and gone after `down -v`.
volumes:
  myservice_db:

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
    type: select                # options belong here, never to the frontend
    label: Region
    default: eu
    options:
      - { value: eu, label: Europe }
      - { value: us, label: United States }

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

# Polled and shown on the dashboard card. Read server-side, so the URL never
# reaches the browser; anything that fails shows as a dash.
info:
  - name: exit_ip
    label: Exit IP
    url: http://localhost:8000/v1/publicip/ip
    extract: public_ip      # dotted path into the JSON; omit for the whole body
    refresh: 300            # seconds, default 60

# Buttons the dashboard offers, POSTed to /services/:name/actions/:action.
actions:
  scan:
    name: scan
    label: Scan libraries
    icon: refresh          # optional, see Action icons
    type: api_call
    url: http://localhost:8080/api/refresh
    method: POST
```

> [!NOTE]
> `actions:` does something and returns nothing. `info:` is something and does
> nothing. Never merge the two.

## Setup steps

| Type | Description |
|------|-------------|
| `wait_ready` | Poll `url` until the service responds. `match`: keep polling until the body matches a regex |
| `api_call` | HTTP request with retry, cookies, tokens, headers. `skipIf: {url, match}` probes first and skips when the work is already done |
| `config_file` | Write `content` to `file` under `paths.config` (`skipIfExists`, default true) |
| `store` | Keep a value that is not an API answer: `store: {from: logs\|file, …}` |

`config_file` steps run **before** `docker compose up` — a container reads its config
at boot. Every other step runs after. The phase comes from the step type.

Any step takes `if:`, which must resolve to `"true"`. A step that will not run never
enters the status list either:

```yaml
- name: register_in_prowlarr
  type: api_call
  if: "{{services.prowlarr.enabled}}"
```

A list means all of them must hold:

```yaml
  if:
    - "{{services.jellyfin.enabled}}"
    - "{{services.sonarr.enabled}}"
```

## Requirements

Declared by **category**, never by service name.

```yaml
requires:
  - category: torrentClient
    supports: [qbittorrent]     # optional: which members actually count
    reason: Sonarr hands every download to a client — install one first.
recommends:
  - category: indexer
    reason: Without an indexer, Sonarr has nothing to search.
```

| Key | Effect |
|-----|--------|
| `requires` | Blocks: the wizard refuses to advance, `POST /install/:name` answers 409 |
| `recommends` | Warns only |
| `supports` | Narrows the category to the peers this template was actually built against |
| `reason` | The sentence the user reads |

Use `supports` only when the wiring is not interchangeable: Sonarr's download-client
step sends a qBittorrent-shaped body, so another client would be a different step.

## Networking

A service routes its traffic through another's tunnel by declaring a capability:

```yaml
# gluetun.yml                  # qbittorrent.yml
network: { provides: vpn }     network: { join: vpn }
```

Both enabled, the joiner gives up its own network stack:

```yaml
gluetun:
  ports: ["8001:8000", "8080:8080", "6881:6881"]   # the joiner's ports move here
qbittorrent:
  network_mode: "service:gluetun"
  depends_on: { gluetun: { condition: service_healthy } }
  # none of its own: a shared namespace cannot publish
```

With no provider enabled, a `join` is inert and the block renders verbatim.

- **Host ports are unchanged**, only their owner — URLs and `wait_ready` on
  `localhost:<port>` keep working.
- **A joined container loses its DNS name**, and the provider takes it as a
  network alias so it answers anyway. Address a peer with `{{host.<service>}}`,
  in `compose:` and in setup steps alike — it resolves to that service's own
  container name whether it is tunnelled or not, which is what keeps an address
  a peer stored yesterday valid today.
- **A provider needs a `healthcheck`** — the joiner waits on `service_healthy`.
- **Refused on a joiner**: `networks`, `hostname`, `links`, `dns`, `dns_search`,
  `extra_hosts`. They belong to the shared namespace.

## Variables

| Variable | Source |
|----------|--------|
| `{{credentials.key}}` | Credential values from the wizard |
| `{{internal.key}}` | Generated secrets, and values stored by previous steps |
| `{{paths.config}}` `{{paths.media}}` `{{paths.torrents}}` | Host paths from the wizard |
| `{{env.PUID}}` `{{env.PGID}}` `{{env.TZ}}` | Host wiring |
| `{{host.<service>}}` | The name a peer must be addressed by — stable across topologies (see Networking) |
| `{{library.name}}` `{{library.type}}` | Current library in a `foreach: libraries` step |
| `{{libraries.<type>_json}}` | All libraries of a type, as JSON |
| `{{internal.<service>.<key>}}` | **Another** service's secret |
| `{{credentials.<service>.<key>}}` | **Another** service's credential |
| `{{services.<service>.enabled}}` | `"true"` / `"false"` |

The last three reach across services: Sonarr reads `{{internal.prowlarr.api_key}}`. An
entry resolving to empty (`FOO=`) is dropped from the compose file, so a blank optional
credential falls back to the image's default.

## `foreach`

Repeats a step over a collection. `libraries` is the only source implemented, and
`foreach: libraries` is shorthand for `foreach: { source: libraries }`. Every option
lives **inside** `foreach`.

```yaml
- name: root_folder
  type: api_call
  foreach:
    source: libraries
    type: tvshows          # keep only libraries of that type
  body:
    path: "/media/{{library.name}}"
```

`map` supplies per-type values, injected as `{{library.<key>}}`:

```yaml
  foreach:
    source: libraries
    map:
      movies:  { content_type: movie, agent: tv.plex.agents.movie }
      tvshows: { content_type: show,  agent: tv.plex.agents.series }
```

## `store`

One way in, for every value a template has to keep. It lands under
`internal.<service>.<as>`, which is where `{{internal.<key>}}` and
`{{internal.<service>.<key>}}` read it back.

| `from` | Where it reads | Needs |
|--------|----------------|-------|
| `body` | The JSON response of the `api_call` it sits on | `path` — a dot path, `Items.0.AccessToken` |
| `cookie` | The `Set-Cookie` header of that response | — |
| `logs` | A container's output, both streams | `container`, `regex` |
| `file` | A file under `paths.config` | `file`, `regex` |

`body` and `cookie` are options **on an `api_call`** — they read its answer.
`logs` and `file` have no answer to read, so they are a step of their own:
`type: store`.

`as` is never defaulted. A session token and a permanent API key must not land
in the same slot by omission — the first expires, the second has to outlive
setup.

For `logs` and `file`, the value is **capture group 1** of `regex`. A `file` step
retries while the file is absent or does not match yet (`maxRetries`, default
15, three seconds apart): a service writes its config when it feels like it.

```yaml
  # on an api_call
  - name: login
    type: api_call
    url: http://localhost:8096/Users/AuthenticateByName
    method: POST
    store: { from: body, path: AccessToken, as: token }

  # a step of its own
  - name: extract_temp_pass
    label: Extract temporary password
    type: store
    store:
      from: logs
      container: qbittorrent
      regex: "A temporary password is provided for this session: (\\S+)"
      as: temp_pass
```

## `after`

Categories whose members must be set up before this one.

```yaml
after:
  - category: mediaServer
  - category: mediaManager
```

Without it the install order is `readdirSync`'s — **the alphabetical order of the
file names**, which no template declares and every template depends on.
`seerr.yml` sorts before `sonarr.yml`, so Seerr reached for a Sonarr whose root
folder did not exist yet, and said so in a `notes:` asking the user to install
them in the right order by hand.

A category, never a service, for the same reason `requires:` names one: adding a
second media manager must not need this line touched.

The sort is **stable** — a template that declares nothing keeps the position it
had, so the progress screen stays predictable. A cycle is logged and the file
order kept: it cannot be blamed on any single file, and refusing to boot over a
relationship between two templates would be worse than the ordering bug it
protects against.

## `uninstall`

What to undo when a **peer** this service wired itself to is removed.

The rule that decides where a cleanup lives: **clean up where the entry is, and
do it when the thing it points at disappears.** Sonarr writes a download client
into its own database pointing at qBittorrent, so removing qBittorrent leaves
Sonarr holding a dead entry — and only Sonarr's API can drop it.

Removing Sonarr itself needs nothing here: the entry goes with the database that
held it.

```yaml
uninstall:
  - when: qbittorrent
    steps:
      - name: drop_download_client
        label: Disconnect qBittorrent
        type: api_call
        method: DELETE
        url: http://localhost:8989/api/v3/downloadclient/{{internal.qbittorrent_client_id}}
        headers:
          X-Api-Key: "{{internal.api_key}}"
        ignoreStatus: [404]
```

The id comes from `store` at creation, not from a probe at deletion:

```yaml
  - name: download_client
    type: api_call
    method: POST
    store: { from: body, path: id, as: qbittorrent_client_id }
```

Runs **after** the container is gone, and a failure is logged and stepped over: a
removal the user asked for must not be held hostage by a peer that will not
answer, and the entry left behind is the state everything was in before.

Nothing is stored when the creation step's `skipIf` found the entry already
there — and there is then nothing this install made to undo either.

## `optional`

A step whose failure is not the template's failure: it records `skipped` and the
pipeline goes on.

For work a service only needs done once. qBittorrent prints a temporary password
on a **virgin** boot and never again, so the three steps that trade it for real
credentials have nothing to do on a service whose config survived a removal —
and failing there would strand an install that had nothing left to do.

Per step, never per type. Plex failing to yield its token is a genuine failure,
and the same `store` step must keep saying so.

## Steps that run later

A step held back by its `if:` **never enters the status list**, and that absence
is the record that it was passed over. So installing the peer it was waiting for
picks it up: after any install, every other enabled template is offered the steps
it has no outcome for.

That is what makes `recommends:` usable in both directions — Sonarr installed
before Prowlarr still ends up registered with it.

Two limits worth knowing:

- **`post_up` only.** A `config_file` step is read by its container at boot, so
  writing one after the fact changes a file nobody rereads. Recreating the
  container is a reconfigure, and the user has to ask for that.
- **It repairs the missing, not the stale.** A replayed step whose `skipIf` probe
  finds an out-of-date entry leaves it exactly as it is: the probe tests
  existence, not content.

## `api_call` options

| Option | Description |
|--------|-------------|
| `contentType: form` | Send body as `application/x-www-form-urlencoded` |
| `store: {from: body, path: …, as: …}` | Keep a field of the JSON response |
| `store: {from: cookie, as: cookie}` / `useCookie` | Save the session cookie, send it on later calls |
| `useToken: '…{{internal.token}}…'` | Send the stored token as `Authorization`, in the shape this service wants |
| `headers: {}` | Custom request headers |
| `retryOn: [503]` | Status codes worth retrying (default `[503]`) |
| `maxRetries: 10` | Attempts (default `10`) |
| `ignoreStatus: [400]` | Treat these as success |
| `merge: true` | Read the resource first, lay `body` over it, send the whole thing back |

## Credential rules

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

Enforced by the API on every credential write (`lib/credential-rules.ts`), and
mirrored in the wizard so it can answer as you type. The API is the authority;
change the two together. A `select` is held to its own `options` the same way,
and a field with no `rules:` is still capped at 512 characters.

**The engine escapes for nothing.** A `{{credentials.x}}` is substituted
verbatim, so a value spliced into a document the template writes itself — a
`config_file` body, or an `api_call` body given as a JSON *string* rather than a
mapping — can close that document and open another. Give those fields a
`pattern`; `templates.test.ts` refuses a template that does not.

A structured `body:` needs none of this: the runner hands it to `JSON.stringify`
or `URLSearchParams`, which quote for you. Prefer that shape.

## What a template may declare

A template is code with root's reach: its `compose:` block is merged into the
file `docker compose up` executes, and its `setup:` steps write files and call
hosts. `lib/template-schema.ts` checks every `.yml` at load — the one the image
ships and the one someone uploads alike — and a file it refuses is skipped with
its reasons in the log, rather than loaded.

**Refused outright**, because they hand a container the host it runs on:

`privileged` · `pid` · `ipc` · `uts` · `userns_mode` · `security_opt` ·
`cgroup_parent` · `sysctls` · `network_mode`

`network_mode` is on the list for a second reason: the engine sets it itself when
a service joins a tunnel, so a template setting it would be silently overwritten
or silently win.

**Bounded rather than refused**, because two services genuinely need them:

| Key | Allowed |
|-----|---------|
| `cap_add` | `NET_ADMIN` — a VPN container raising a WireGuard interface |
| `devices` | `/dev/net/tun`, `/dev/dri` — the tunnel, and GPU transcoding |

**Bind mounts start under a wizard path**: `{{paths.config}}`, `{{paths.media}}`
or `{{paths.torrents}}`, and they stay there — a `..` in the tail is refused, since
a prefix is not containment and Compose passes the string to the daemon untouched.
Anything else must be a named volume the template declares in `volumes:`.

**Paths stay relative and stay put.** `file:`, `dirs:` and `reset.dirs:` may not
be absolute and may not contain `..`. `reset.dirs` is the sharpest of the three:
its contents are deleted recursively on a reconfigure.

**Names are names.** `id`, `container:` and a step's `container:` match
`^[A-Za-z0-9][A-Za-z0-9_-]*$` — no dots, because a container name is also an
address the engine agrees to fetch, and `metadata.example.com` is not a service
you run.

**Patterns are short.** `regex`, `match`, `skipIf.match` and a credential's
`rules.pattern` are capped at 200 characters: they are compiled and run against a
service's output.

Needing something this list forbids is a conversation, not a workaround — the
list lives in one file and changing it is a reviewed change.

## The service logo

A file, not code: `packages/web/src/icons/<id>.svg`, found by filename. The
directory is globbed at build time, so adding a service is dropping its `.svg`
beside the others and touching nothing else.

[dashboardicons.com](https://dashboardicons.com) has a mark for every self-hosted
app in this stack. **Take the monochrome variant** and set `fill="currentColor"`
on its root: the tile then picks up the service's own hue. A full-colour logo
gets a neutral tile instead, which is the right call — an orange illustration on
a green tile reads as a mistake — but it also weighs three or four times as much
and turns to mush at the 20px these render at.

A service with no icon still works; it gets `_default.svg`, a plain circle. The
gate runs the other way only: `templates.test.ts` fails on an icon whose template
is gone, since nothing else would ever point that file out.

## Action icons

Optional and **case-sensitive**; an unknown name falls back to a generic glyph.
`src/templates.test.ts` reads the list out of
[`ActionIcon.tsx`](../packages/web/src/components/ui/ActionIcon.tsx).

`refresh` (spins while running) · `play` · `stop` · `power` · `download` · `upload` ·
`trash` · `search` · `key` · `open` · `check` · `cog`
