# 2. A template is code, and is validated as such

**Status** — accepted, 2026-09-11.

## Context

`templates/*.yml` is where this project puts everything a service needs, and the
design deliberately keeps service knowledge out of `src/`. The price is that a
template reaches far: its `compose:` block is merged verbatim into the file
`docker compose up` executes, and its `setup:` steps write files under
`paths.config`, delete directories on a reconfigure, and make HTTP calls with
stored secrets attached.

The loader used to `parse()` the YAML and cast it: `parse(raw) as ServiceTemplate`.
Nothing checked the result. Two consequences followed. A malformed file — an
empty one was enough — threw inside `loadTemplates`, which runs before the server
listens, so the API never came up again. And a well-formed hostile one could ask
for `privileged: true` and `volumes: ["/:/host"]`, which the daemon would grant.

The dashboard also exposes an upload endpoint, so "a template" is not only what
the image ships.

## Decision

A template is **root-equivalent code**, and is treated as such: validated at
load, shipped and uploaded alike, by `lib/template-schema.ts`. A file that does
not validate is skipped with its reasons in the log, never loaded.

The validator answers with a list of reasons rather than a boolean, and **never
throws** — its answer becomes a 400 the uploader can act on, and an exception
there would be a 500 that says nothing.

Uploads are written only after validating, and never over an existing file.

## Consequences

**The compose guard is a denylist for the keys that hand over the host, and an
allowlist of values for the two that have legitimate uses.** `privileged`, `pid`,
`ipc`, `uts`, `userns_mode`, `security_opt`, `cgroup_parent`, `sysctls` and
`network_mode` are refused outright. `cap_add` and `devices` are not: gluetun
needs `NET_ADMIN` and `/dev/net/tun` to raise a WireGuard interface, and a media
server needs `/dev/dri` to transcode. A blanket refusal would have broken the
shipped catalogue, which is how a guard gets switched off six months later.

**A bind mount must start under `{{paths.*}}` and stay there.** The first version
tested the prefix only, and `{{paths.media}}/../../../../var/run/docker.sock`
walked straight through it — Compose passes the string to the daemon untouched. A
prefix is not containment.

**Names are addresses.** `container:` feeds the allowlist of hosts the engine
will fetch (see `lib/service-url.ts`), so it may not contain a dot: a template
calling itself `169.254.169.254` would otherwise reopen the hole that allowlist
closes.

**This file is not `templates.test.ts`.** The validator is about safety and shape
at runtime; the test suite is about correctness against the real catalogue, where
a human reads the failure, and it can afford to be stricter. The two overlap on
purpose and are allowed to disagree — the suite holds shipped ids to
`^[a-z0-9-]+$`, the validator has to accept whatever an operator may legitimately
upload.

**The key lists are checked against the types at compile time.** `TEMPLATE_KEYS`,
`STEP_KEYS` and `STEP_TYPES` mirror `ServiceTemplate`, `SetupStepDef` and the
runner's own switch; adding a step type and forgetting the list would drop every
template using it, silently, at load. `tsc` now refuses that.

**Revisit if** the upload endpoint is ever removed. Much of this exists because
a template can arrive at runtime; with only the image's own files, the boot
tolerance still earns its place but the guard would be a lint, not a gate.
