# 3. No shell between the API and Docker

**Status** — accepted, 2026-09-11.

## Context

`lib/docker-cli.ts` used to build a command as a string —
`docker compose -p … -f "…" ${args}` — and every caller handed it to `execSync`
or `promisify(exec)`, both of which run it through `/bin/sh`.

Eighteen call sites did that. Four of them interpolated values straight from an
HTTP request: `GET /services/:name/logs?lines=…` executed whatever the query
string contained, which was demonstrated live. The rest interpolated values from
template fields and from an environment variable, which are lower-trust than they
look — one of them is a field of an uploadable file.

Escaping each site was possible. Keeping every future site escaped was not.

## Decision

`lib/docker-cli.ts` builds an **argv array** and runs it through `execFile` /
`spawnSync`. No shell is involved anywhere in that module, and no caller builds a
command of its own.

## Consequences

**The injection class is gone, not the three known instances.** A container name,
a `--tail` value or a project name cannot end one command and start another,
whatever they contain. That property does not depend on anyone remembering to
quote.

**Shell redirections had to go with it.** `2>/dev/null` and `2>&1` were doing real
work: silencing an expected `docker inspect` failure, and merging the two streams
a container logs to. Both are now options on the runner (`mergeStderr`, and
capturing stderr instead of forwarding it) rather than syntax in a string.

**`maxBuffer` and timeouts became explicit.** The 1 MB Node gives a child by
default truncated a chatty container's logs and reported it as a failed command.
Read commands carry a timeout; `up`, `down` and `pull` deliberately do not, since
a first install pulls a dozen images.

**Callers must resolve a name before they pass it.** Argv makes the shell safe,
not the semantics: the four fixed verbs now resolve the path parameter through
`getTemplate()` and pass `tpl.container`, the way the reconfigure, delete and
info routes already did. Driving a container this install does not own is not
something the API should offer either.

**Revisit** never, as far as this codebase is concerned. If a future need seems
to require a shell — a pipeline, a glob — it is a sign the work belongs in
TypeScript instead.
