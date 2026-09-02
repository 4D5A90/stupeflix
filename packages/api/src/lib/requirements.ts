import type { Requirement, ServiceTemplate } from "./service-registry.js";

export interface UnmetRequirement {
	/** The service that declares the need, not the one that would satisfy it. */
	service: string;
	category: string;
	reason?: string;
}

export interface RequirementReport {
	/** Blocking: the service cannot work at all. */
	missing: UnmetRequirement[];
	/** Informative: it runs, just badly. */
	warnings: UnmetRequirement[];
}

function unmet(
	tpl: ServiceTemplate,
	reqs: Requirement[] | undefined,
	covered: Set<string>,
): UnmetRequirement[] {
	return (reqs ?? [])
		.filter((r) => !covered.has(r.category))
		.map((r) => ({ service: tpl.id, category: r.category, reason: r.reason }));
}

/**
 * What a selection is missing. The split is the whole point: Seerr cannot even
 * create its first account without a media server, while Sonarr without Prowlarr
 * still runs — its owner just has to add indexers by hand. Refusing the second
 * case would forbid a perfectly legitimate stack.
 *
 * Nothing here names a service: a need is expressed as a category, and any
 * enabled template of that category answers it.
 *
 * Mirrored in `web/src/types/setup.ts` so the wizard can react as the user
 * toggles. This side is the authority — change the two together.
 */
export function checkRequirements(
	templates: ServiceTemplate[],
	enabledIds: string[],
): RequirementReport {
	const enabled = templates.filter((t) => enabledIds.includes(t.id));
	const covered = new Set(enabled.map((t) => t.category));
	return {
		missing: enabled.flatMap((t) => unmet(t, t.requires, covered)),
		warnings: enabled.flatMap((t) => unmet(t, t.recommends, covered)),
	};
}

/**
 * The blocking needs `tpl` would still have once added to `enabledIds`. The
 * Dashboard installs a service on its own, outside the wizard, so the API has
 * to answer this question too — a check that lives only in the frontend is a
 * check anyone can walk around.
 */
export function unmetRequirements(
	templates: ServiceTemplate[],
	enabledIds: string[],
	tpl: ServiceTemplate,
): UnmetRequirement[] {
	const withIt = [...new Set([...enabledIds, tpl.id])];
	return checkRequirements(templates, withIt).missing.filter(
		(m) => m.service === tpl.id,
	);
}

/**
 * One sentence per unmet need. The wording belongs to the template — it is the
 * only place that knows *why* the dependency exists — and this only falls back
 * to a generic line when a template did not bother to say.
 */
export function requirementMessage(unmet: UnmetRequirement[]): string {
	return unmet
		.map((u) => u.reason ?? `${u.service} requires a "${u.category}" service.`)
		.join(" ");
}
