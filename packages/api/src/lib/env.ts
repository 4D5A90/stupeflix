function fromEnv(key: string): string | undefined {
	const value = process.env[key];
	return value && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * Host directory mounted at the same path inside the container.
 * Empty when running directly on the host — everything below then falls back to
 * repo-relative paths, so host development behaves exactly as before.
 */
export const ROOT = fromEnv("STUPEFLIX_ROOT")?.replace(/\/+$/, "") ?? "";

/** SQLite database. */
export const DB_PATH = fromEnv("STUPEFLIX_DB_PATH") ?? "./data/stupeflix.db";

/** Generated compose file. Kept next to the database so both move together. */
export const COMPOSE_FILE =
	fromEnv("STUPEFLIX_COMPOSE_FILE") ?? "./data/docker-compose.yml";

/**
 * Compose project name. Fixed rather than derived from the working directory,
 * so the same containers are owned whether Stupeflix runs from source or as the
 * packaged image — otherwise both fight over the same `container_name`.
 */
export const COMPOSE_PROJECT =
	fromEnv("STUPEFLIX_COMPOSE_PROJECT") ?? "stupeflix";

/** Service templates. */
export const TEMPLATES_DIR = fromEnv("STUPEFLIX_TEMPLATES_DIR");

/** Where the shipped stacks live. Absent is legal — there is simply no fork. */
export const STACKS_DIR = fromEnv("STUPEFLIX_STACKS_DIR");

/** Built frontend. When set, the API also serves the web UI on the same port. */
export const WEB_DIR = fromEnv("STUPEFLIX_WEB_DIR");

/** sql.js wasm binary. Needed once the API is bundled away from node_modules. */
export const WASM_PATH = fromEnv("STUPEFLIX_SQL_WASM");

/**
 * How the API reaches the service containers, which publish their ports on the host.
 * `host.docker.internal` when we run inside a container ourselves.
 */
export const SERVICE_HOST = fromEnv("STUPEFLIX_SERVICE_HOST") ?? "127.0.0.1";

/**
 * The host a browser opens a service on, when it is not the one the dashboard
 * was reached by. Behind a reverse proxy on another machine, the page's own
 * host is the proxy, where no service port answers. Unset, the dashboard uses
 * the page's host — right whenever the page and the services share a machine.
 */
export const PUBLIC_HOST = fromEnv("STUPEFLIX_PUBLIC_HOST");

/** A name, an IPv4 or a bracketed IPv6 — nothing that adds to `http://<host>:<port>`. */
const HOST_SHAPE = /^([A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])$/;

export function publicHostProblem(host: string): string | null {
	return HOST_SHAPE.test(host)
		? null
		: "must be a bare host, like 192.168.1.17 — no scheme, port or path";
}

/** Ownership applied to service containers — process uid/gid is meaningless in a container. */
export const PUID = fromEnv("PUID") ?? String(process.getuid?.() ?? 1000);
export const PGID = fromEnv("PGID") ?? String(process.getgid?.() ?? 1000);

/** Timezone handed to service containers via `{{env.TZ}}`. */
export const TZ = fromEnv("TZ") ?? "Europe/Paris";

export const PORT = Number(fromEnv("PORT") ?? 3000);

/**
 * Interface the server binds. All of them by default: this is an assistant you
 * open from another machine, and it is the access token — not the topology —
 * that closes the door. Pin it to `127.0.0.1` to put the door back.
 */
export const HOST = fromEnv("HOST") ?? "0.0.0.0";

/**
 * Access token, when the deployment manages its own secrets. Left unset, one is
 * minted on first boot and kept in the database — see `lib/auth.ts`.
 */
export const TOKEN = fromEnv("STUPEFLIX_TOKEN");
