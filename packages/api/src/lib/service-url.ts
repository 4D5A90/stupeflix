import { SERVICE_HOST } from "./env.js";

/**
 * The addresses a template is allowed to name, whatever it writes.
 *
 * This function used to be a substring rewrite living in `env.ts` — it turned
 * `://localhost` into `://<SERVICE_HOST>` and passed everything else through.
 * It sat in front of every `fetch` the engine makes and therefore *read* like a
 * guard, which is the dangerous kind of not being one: a template could name
 * `http://169.254.169.254/…` and have the API fetch it and hand the body back
 * through `GET /services/:name/info`. The regex was not even anchored, so
 * `http://localhost.evil.com` was rewritten into a domain the attacker owned.
 *
 * The rule now is an allowlist: a service lives either on the host that
 * publishes the container ports, or at a container name this install declares.
 * There is no third place.
 */
// `[::1]` with the brackets: `new URL("http://[::1]/").hostname` keeps them,
// unlike every other host it returns.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function serviceUrl(raw: string, containers: Iterable<string>): string {
	// `step.url ?? ""` for a step type that has no URL. Callers turn this back
	// into `undefined`; parsing it would only throw.
	if (raw === "") return "";

	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`${raw} is not a URL`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`${url.protocol} is not a scheme a service answers on`);
	}

	// `hostname` and not `host`: it drops the port, and it ignores userinfo —
	// which is how `http://127.0.0.1@evil.com` used to read as loopback.
	const host = url.hostname;
	if (LOOPBACK.has(host)) {
		// Force the published-port host. Left as `localhost` it may resolve to
		// ::1, where a container publishing on 0.0.0.0 does not answer.
		url.hostname = SERVICE_HOST;
		return url.href;
	}
	if (host === SERVICE_HOST) return url.href;
	for (const container of containers) {
		if (host === container) return url.href;
	}
	throw new Error(`${host} is not a service this install runs`);
}

/**
 * Whether a URL points at the service itself, rather than at one of its peers.
 *
 * Honest about its limit: every service publishes on the same `SERVICE_HOST`,
 * so a peer addressed by published port is indistinguishable from the service
 * itself — and it has to be, because that is how a template reaches its own API
 * (`http://localhost:8080/...`). What this does close is the `{{host.x}}` form,
 * where a template names a peer's container and would otherwise be handed
 * another service's stored session.
 */
export function isOwnHost(url: string, container: string): boolean {
	try {
		const host = new URL(url).hostname;
		return host === container || host === SERVICE_HOST || LOOPBACK.has(host);
	} catch {
		return false;
	}
}
