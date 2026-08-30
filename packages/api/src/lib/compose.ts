import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { stringify } from "yaml";
import type { Db } from "../db.js";
import { COMPOSE_FILE } from "./env.js";
import {
	applyNetworkTopology,
	networkHosts,
	resolveNetworkTopology,
} from "./network.js";
import {
	ensureSecrets,
	getEnabledTemplates,
	getTemplates,
} from "./service-registry.js";
import { buildVars, resolveTemplateVars } from "./template-vars.js";

/** Writes the generated compose file where the docker CLI wrapper expects it. */
export function writeCompose(db: Db): string {
	mkdirSync(dirname(COMPOSE_FILE), { recursive: true });
	writeFileSync(COMPOSE_FILE, generateCompose(db));
	return COMPOSE_FILE;
}

/**
 * `FOO=` reads as "unset" to every image we ship, so an optional credential that
 * the user left blank drops out instead of shadowing the image's own default.
 */
function pruneEmptyEnv(service: unknown): unknown {
	if (service === null || typeof service !== "object") return service;
	const entries = (service as Record<string, unknown>).environment;
	if (!Array.isArray(entries)) return service;
	return {
		...(service as Record<string, unknown>),
		environment: entries.filter(
			(e) => typeof e !== "string" || !/^[^=]+=$/.test(e),
		),
	};
}

/**
 * The compose file is the union of the `compose:` blocks of the enabled templates.
 * Adding a service is adding a YAML file — this function never learns its name.
 */
export function generateCompose(db: Db): string {
	const services: Record<string, unknown> = {};

	// Every secret first, then every render: a template may reference another's
	// generated key, so none of them can be minted lazily mid-loop.
	for (const tpl of getEnabledTemplates(db)) {
		ensureSecrets(db, tpl);
	}

	// Resolved before rendering: `{{host.<id>}}` has to know who ends up owning
	// each namespace, since a joined service loses its own DNS name.
	const topology = resolveNetworkTopology(getEnabledTemplates(db));
	const hosts = networkHosts(getTemplates(), topology);

	for (const tpl of getEnabledTemplates(db)) {
		const vars = { ...buildVars(db, tpl.id), ...hosts };
		const resolved = resolveTemplateVars(tpl.compose ?? {}, vars) as Record<
			string,
			unknown
		>;
		for (const [name, service] of Object.entries(resolved)) {
			services[name] = pruneEmptyEnv(service);
		}
	}

	applyNetworkTopology(services, topology);

	return stringify({ services });
}
