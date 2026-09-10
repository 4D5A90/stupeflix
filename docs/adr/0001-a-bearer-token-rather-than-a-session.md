# 1. A bearer token, rather than a session

**Status** — accepted, 2026-09-11.

## Context

Until this decision the API had no authentication at all. Every endpoint — the
ones that drive Docker, wipe configs, write files and return every stored secret
— answered anyone who could open a TCP connection to port 3000, and, because
CORS was a wildcard, any web page the operator happened to visit. The process
runs as root with `/var/run/docker.sock` mounted, so reaching the API was
reaching root on the host.

The goal set for the fix was specific: **nothing exploitable even when the API is
reachable on the LAN.** That rules out relying on network placement.

Two models were on the table: a bearer token, or a password login backed by a
signed session cookie.

## Decision

A bearer token, checked by one middleware in front of every route except
`GET /health`.

It is minted on first boot and kept in the database, or pinned through
`STUPEFLIX_TOKEN`. A pinned one is validated at boot against the characters an
`Authorization` header can carry, and the server refuses to start rather than
start unreachable with its own correct token.

## Consequences

**No CSRF middleware, and that is the point rather than an omission.** A
cross-origin page cannot set an `Authorization` header without a preflight this
API never answers, so a forged form POST arrives with no token and is refused
like any other anonymous request. A session cookie would have travelled on its
own and would have needed guarding separately. Adding `csrf()` anyway would have
bought nothing and would have refused `curl -d` for having no `Origin` —
including the throwaway-stack recipe the README documents.

**No user store, no password hashing, no session secret, no expiry.** There is
one operator and one door.

**The token is kept, not regenerated.** One that changed on every restart would
sign the browser out each time and teach the operator to paste whatever token a
screen asks for, which is the habit a phishing page needs.

**`STUPEFLIX_TOKEN` has a charset**, and it is a leaked implementation detail of
the header parser. Documented rather than worked around: writing our own header
parsing to accept a passphrase would be more code and more risk than telling
people to use `openssl rand -base64 32`.

**Two things this decision makes unnecessary**, and neither should be read as an
oversight:

- *No non-root `USER` in the Dockerfile.* The Docker socket is mounted, so a
  non-root user in the `docker` group is root on the host regardless. The gain is
  nil and the cost real — the socket's gid varies by machine, and pinning it at
  build time makes the image machine-specific.
- *The server still binds `0.0.0.0`.* This is an assistant you open from another
  machine or a phone; loopback would break the normal use. `HOST` pins it for
  anyone who wants that, and it is now the token that closes the door.

**Revisit if** Stupeflix ever grows more than one user, or needs to hand a
scoped credential to something that is not the operator's browser.
