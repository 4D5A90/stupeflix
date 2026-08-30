import type { ServiceTemplate } from "./service-registry.js";

/**
 * Two templates connect through a declared capability, never by naming each
 * other — the same idea as `{{internal.prowlarr.api_key}}`, applied to network
 * topology instead of values.
 *
 * A VPN template declares `network: { provides: vpn }`; a torrent client
 * declares `network: { join: vpn }`. When both are enabled the joiner gives up
 * its own network stack and lives inside the provider's, so its traffic cannot
 * leave except through the tunnel. With no provider enabled, nothing happens and
 * the joiner's compose block comes out untouched.
 */

/**
 * Settings Docker refuses on a container using `network_mode: service:`. Only
 * `networks` is caught by `docker compose config`; the rest fail at `up` with
 * "conflicting options: … and the network mode", so they are rejected here.
 *
 * They are not moved to the owner on purpose: every one of them is a property of
 * the *namespace*, so moving it would silently change behaviour for the provider
 * and for every other joiner — a template editing its neighbours behind their
 * backs, which is what this design exists to prevent.
 */
const FORBIDDEN_ON_JOINER = [
	"networks",
	"hostname",
	"links",
	"dns",
	"dns_search",
	"extra_hosts",
] as const;

export interface NetworkTopology {
	/** Compose service → the compose service whose network namespace it shares. */
	joins: Map<string, string>;
}

export function resolveNetworkTopology(
	templates: ServiceTemplate[],
): NetworkTopology {
	const providers = new Map<string, string>();
	for (const tpl of templates) {
		const capability = tpl.network?.provides;
		if (!capability) continue;
		const other = providers.get(capability);
		if (other && other !== tpl.container) {
			throw new Error(
				`Two enabled services provide the "${capability}" network: "${other}" and "${tpl.container}". Enable only one.`,
			);
		}
		providers.set(capability, tpl.container);
	}

	const joins = new Map<string, string>();
	for (const tpl of templates) {
		const capability = tpl.network?.join;
		if (!capability) continue;
		const provider = providers.get(capability);
		// Nothing provides it: the service keeps its own stack, as if it never asked
		if (!provider || provider === tpl.container) continue;
		joins.set(tpl.container, provider);
	}
	return { joins };
}

/**
 * The compose service other containers must address a template by. It is the
 * provider once a service has joined one, because a container sharing a
 * namespace has no DNS name of its own — this is what `{{host.<id>}}` resolves.
 */
export function networkHosts(
	templates: ServiceTemplate[],
	{ joins }: NetworkTopology,
): Record<string, string> {
	const hosts: Record<string, string> = {};
	for (const tpl of templates) {
		hosts[`host.${tpl.id}`] = joins.get(tpl.container) ?? tpl.container;
	}
	return hosts;
}

/**
 * Compose services that have to be brought up together with `container`.
 *
 * Installing a provider moves its joiners' ports onto it, and installing a
 * joiner moves its own — so starting one alone leaves the other holding host
 * ports the new definition assigns elsewhere, and Docker refuses to bind them.
 *
 * `joiners` is what must be stopped first: they cannot simply be started
 * afterwards, since they wait on the provider being healthy, and the provider
 * cannot start while they still hold its ports.
 */
export function affectedServices(
	container: string,
	{ joins }: NetworkTopology,
): { all: string[]; joiners: string[] } {
	const joiners = new Set<string>();
	const provider = joins.get(container);
	if (provider) joiners.add(container);
	for (const [joiner, its] of joins) {
		if (its === container) joiners.add(joiner);
	}
	const all = new Set<string>([container, ...joiners]);
	if (provider) all.add(provider);
	return { all: [...all], joiners: [...joiners] };
}

/** Rewrites the merged compose services so the joiners live inside their provider. */
export function applyNetworkTopology(
	services: Record<string, unknown>,
	{ joins }: NetworkTopology,
): void {
	for (const [name, provider] of joins) {
		const joiner = services[name] as Record<string, unknown> | undefined;
		const owner = services[provider] as Record<string, unknown> | undefined;
		if (!joiner || !owner) continue;

		for (const key of FORBIDDEN_ON_JOINER) {
			if (key in joiner) {
				throw new Error(
					`"${name}" joins the network of "${provider}", so it cannot declare "${key}": that setting belongs to the namespace owner.`,
				);
			}
		}

		// A container with no stack of its own cannot publish. Moving the ports is
		// also what makes the tunnel a kill switch instead of a setting: published
		// by the joiner, they would bypass it.
		if (Array.isArray(joiner.ports)) {
			owner.ports = [
				...((owner.ports as unknown[] | undefined) ?? []),
				...joiner.ports,
			];
			// The key has to be gone, not undefined: a joiner is checked by key
			// presence, and the compose file is rewritten from these objects.
			// biome-ignore lint/performance/noDelete: presence is the meaning here
			delete joiner.ports;
		}
		// Refused by the daemon, and a no-op annotation, so dropping it costs nothing
		// biome-ignore lint/performance/noDelete: presence is the meaning here
		delete joiner.expose;

		joiner.network_mode = `service:${provider}`;
		// Starting before the tunnel is up would leak in the clear, so this is a
		// safety property rather than a convenience — hence `service_healthy`.
		joiner.depends_on = {
			...((joiner.depends_on as Record<string, unknown> | undefined) ?? {}),
			[provider]: { condition: "service_healthy" },
		};
	}
}
