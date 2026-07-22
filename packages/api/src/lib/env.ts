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

/** Generated compose file — read by the docker CLI, so a container-local path is fine. */
export const COMPOSE_FILE =
	fromEnv("STUPEFLIX_COMPOSE_FILE") ?? "./docker-compose.yml";

/** Compose project name. Unset on the host (compose derives it from the cwd). */
export const COMPOSE_PROJECT = fromEnv("STUPEFLIX_COMPOSE_PROJECT") ?? "";

/**
 * Assets bind-mounted into service containers (Flood UI).
 * Must be a path the Docker daemon can see, hence ROOT rather than a container-only dir.
 */
export const ASSETS_DIR =
	fromEnv("STUPEFLIX_ASSETS_DIR") ?? (ROOT ? `${ROOT}/assets` : "./assets");

/** Service templates. */
export const TEMPLATES_DIR = fromEnv("STUPEFLIX_TEMPLATES_DIR");

/** Built frontend. When set, the API also serves the web UI on the same port. */
export const WEB_DIR = fromEnv("STUPEFLIX_WEB_DIR");

/** sql.js wasm binary. Needed once the API is bundled away from node_modules. */
export const WASM_PATH = fromEnv("STUPEFLIX_SQL_WASM");

/**
 * How the API reaches the service containers, which publish their ports on the host.
 * `host.docker.internal` when we run inside a container ourselves.
 */
export const SERVICE_HOST = fromEnv("STUPEFLIX_SERVICE_HOST") ?? "127.0.0.1";

/** Ownership applied to service containers — process uid/gid is meaningless in a container. */
export const PUID = fromEnv("PUID") ?? String(process.getuid?.() ?? 1000);
export const PGID = fromEnv("PGID") ?? String(process.getgid?.() ?? 1000);

export const PORT = Number(fromEnv("PORT") ?? 3000);

/** Rewrites a template URL so it points at the host running the service containers. */
export function serviceUrl(url: string): string {
	// Force IPv4 — containers listen on 0.0.0.0, but localhost may resolve to ::1
	return url.replace(/:\/\/(localhost|127\.0\.0\.1)/, `://${SERVICE_HOST}`);
}
