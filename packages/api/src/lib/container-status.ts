import { runDockerSync } from "./docker-cli.js";
import { COMPOSE_PROJECT } from "./env.js";

/**
 * How long a reading is reused. Long enough to collapse the burst the dashboard
 * makes when it loads, short enough that a container started a moment ago shows
 * up before docker has finished starting it anyway.
 */
const TTL_MS = 1000;

let cached: Map<string, string> | null = null;
let cachedAt = 0;

/**
 * The state of every container in the project, in one call.
 *
 * `GET /status` and `GET /services` used to fork one `docker inspect` per
 * template — a dozen processes per request, on two routes the dashboard polls
 * and anyone can call in a loop. One `docker ps` answers the same question for
 * all of them.
 */
export function containerStatuses(): Map<string, string> {
	if (cached && Date.now() - cachedAt < TTL_MS) return cached;
	const statuses = new Map<string, string>();
	try {
		const out = runDockerSync([
			"ps",
			"-a",
			"--filter",
			`label=com.docker.compose.project=${COMPOSE_PROJECT}`,
			"--format",
			"{{.Names}}\t{{.State}}",
		]);
		for (const line of out.split("\n")) {
			const [name, state] = line.split("\t");
			if (name && state) statuses.set(name, state);
		}
	} catch {
		// Docker unreachable: everything reads as absent, which is what a failing
		// `inspect` said one container at a time.
	}
	cached = statuses;
	cachedAt = Date.now();
	return statuses;
}

/** `docker inspect`'s vocabulary — running, exited, created — or not_found. */
export function containerStatus(container: string): string {
	return containerStatuses().get(container) ?? "not_found";
}
