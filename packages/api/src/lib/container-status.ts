import { runDockerSync } from "./docker-cli.js";
import { COMPOSE_PROJECT } from "./env.js";

/**
 * How long a reading is reused. Long enough to collapse the burst the dashboard
 * makes when it loads, short enough that a container started a moment ago shows
 * up before docker has finished starting it anyway.
 */
const TTL_MS = 1000;

/**
 * What one container reads as. `state` is `docker ps`'s own vocabulary and stays
 * the only thing callers see by default; `health` is a second, independent axis
 * that only exists for a container declaring a `healthcheck:`.
 */
export interface ContainerState {
	state: string;
	health?: "healthy" | "unhealthy" | "starting";
}

let cached: Map<string, ContainerState> | null = null;
let cachedAt = 0;

/**
 * `.Status` is prose — "Up 2 hours (unhealthy)", "Exited (0) 3 minutes ago" —
 * not a vocabulary, which is why it supplements `.State` rather than replacing
 * it. Only the parenthesised health marker is read out of it.
 */
function healthOf(status: string): ContainerState["health"] {
	if (/\(healthy\)/.test(status)) return "healthy";
	if (/\(unhealthy\)/.test(status)) return "unhealthy";
	if (/\(health: starting\)/.test(status)) return "starting";
	return undefined;
}

/** `docker ps --format "{{.Names}}\t{{.State}}\t{{.Status}}"`, as a lookup. */
export function parseStatuses(out: string): Map<string, ContainerState> {
	const statuses = new Map<string, ContainerState>();
	for (const line of out.split("\n")) {
		const [name, state, status] = line.split("\t");
		if (!name || !state) continue;
		const trimmed = state.trim();
		// A stopped container carries no health: docker keeps the last probe in
		// `.Status` for some states, and reporting it would say a container that
		// is not running is unhealthy, which is a different problem than the one
		// the badge is for.
		const health = trimmed === "running" ? healthOf(status ?? "") : undefined;
		statuses.set(
			name,
			health ? { state: trimmed, health } : { state: trimmed },
		);
	}
	return statuses;
}

/**
 * The state of every container in the project, in one call.
 *
 * `GET /status` and `GET /services` used to fork one `docker inspect` per
 * template — a dozen processes per request, on two routes the dashboard polls
 * and anyone can call in a loop. One `docker ps` answers the same question for
 * all of them.
 */
export function containerStatuses(): Map<string, ContainerState> {
	if (cached && Date.now() - cachedAt < TTL_MS) return cached;
	let statuses = new Map<string, ContainerState>();
	try {
		statuses = parseStatuses(
			runDockerSync([
				"ps",
				"-a",
				"--filter",
				`label=com.docker.compose.project=${COMPOSE_PROJECT}`,
				"--format",
				"{{.Names}}\t{{.State}}\t{{.Status}}",
			]),
		);
	} catch {
		// Docker unreachable: everything reads as absent, which is what a failing
		// `inspect` said one container at a time.
	}
	cached = statuses;
	cachedAt = Date.now();
	return statuses;
}

/** Drops the memo, so a test — or a caller that just changed things — re-reads. */
export function forgetContainerStatuses(): void {
	cached = null;
}

/** `docker inspect`'s vocabulary — running, exited, created — or not_found. */
export function containerStatus(container: string): string {
	return containerStatuses().get(container)?.state ?? "not_found";
}

/**
 * `healthy`, `unhealthy`, `starting` — or nothing at all, which is the common
 * case: a container without a `healthcheck:` has no health to report, and that
 * is not the same as being unhealthy.
 */
export function containerHealth(
	container: string,
): ContainerState["health"] | undefined {
	return containerStatuses().get(container)?.health;
}
