# Testing

`pnpm test` covers the template engine: variable resolution, compose generation,
secret minting, `config_file` writing, step phases, `store` extraction. And
`src/templates.test.ts` runs against the **real** `templates/` directory — every
`{{...}}` must resolve, `container_name` must match `container`, a peer must be
addressed through `{{host.x}}`, every `requires`/`recommends` category must be one
some template provides, every `foreach` source must be one the runner implements,
and no compose name or host port may collide.

**Adding a service means keeping that suite green.** It is what replaces the
per-service code that used to exist.

## What the suite cannot cover

Anything that shells out to Docker or talks to a live service: `compose up`,
`rm --remove-orphans`, and every `api_call`, `wait_ready` and `store` step aimed
at a running container. Changes there need a real run.

That run is worth the trouble. It is what caught `priority` being a top-level
field of Sonarr's download client rather than one of its `fields[]`, which no
amount of reading the API docs had revealed.

## Never against your own stack

Two reasons, both of which destroy state you care about:

- a reconfigure **deletes generated configs** — that is what `reset.dirs` means;
- `container_name` is a **global Docker namespace**, so a second instance fights
  the first for the same containers.

`lib/instance.ts` catches the second case and answers 409 rather than letting two
instances collect each other's services as orphans. Do not rely on it — run
isolated.

## The isolated recipe

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
STUPEFLIX_TOKEN=e2e-token-at-least-16-chars \
PORT=3999 pnpm --filter api dev
```

Then drive it, polling until the run settles:

```bash
curl -s -H "Authorization: Bearer e2e-token-at-least-16-chars" \
  -X POST localhost:3999/setup/complete
curl -s -H "Authorization: Bearer e2e-token-at-least-16-chars" \
  localhost:3999/setup/status
```

**Pin the token.** Every route but `GET /health` needs a bearer token, and an
unpinned one is minted into the database on first boot — which means digging it
back out before you can drive anything. `STUPEFLIX_TOKEN` is checked at boot
against what an `Authorization` header can carry, so a token it would refuse
stops the server rather than leaving it unreachable.

**Keep the published ports unchanged.** Setup steps address services as
`localhost:<port>`, so renaming a port breaks the run for reasons that have
nothing to do with what you are testing.

**Only rename `container_name`.** The compose service key is what containers
resolve each other by on the network, and `{{host.x}}` resolves to the service's
own container name — rename the key and peers stop finding each other.

## Cleaning up

```bash
docker compose -p stupeflix-e2e -f /tmp/sfx/data/docker-compose.yml down -v
trash /tmp/sfx
```
