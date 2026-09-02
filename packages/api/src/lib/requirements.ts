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

/**
 * Why a need is not met, which is two different situations asking for two
 * different fixes: install something of that kind, or pick a different one.
 */
function unmetReason(
	tpl: ServiceTemplate,
	req: Requirement,
	enabled: ServiceTemplate[],
	all: ServiceTemplate[],
): string | undefined | null {
	const inCategory = enabled.filter((t) => t.category === req.category);
	if (inCategory.length === 0) return req.reason;
	if (!req.supports) return null;

	const supported = inCategory.filter((t) => req.supports?.includes(t.id));
	if (supported.length > 0) return null;

	// Generated rather than authored: the template cannot know in advance which
	// unsupported peer someone would pick, and "install one first" would be wrong
	// advice here — there is one installed.
	// Named from every template, not the enabled ones: the service being asked
	// for is by definition the one that is not installed.
	const names = (ids: string[]) =>
		ids.map((id) => all.find((t) => t.id === id)?.name ?? id).join(" or ");
	return `${tpl.name} only works with ${names(req.supports)}, and ${names(
		inCategory.map((t) => t.id),
	)} is installed instead.`;
}

/**
 * What a selection is missing. The split is the whole point: Seerr cannot even
 * create its first account without a media server, while Sonarr without Prowlarr
 * still runs — its owner just has to add indexers by hand. Refusing the second
 * case would forbid a perfectly legitimate stack.
 *
 * A need names a category, never a service. `supports:` narrows which members of
 * that category count, without the requirement ever becoming a service name.
 *
 * Mirrored in `web/src/types/setup.ts` so the wizard can react as the user
 * toggles. This side is the authority — change the two together.
 */
export function checkRequirements(
	templates: ServiceTemplate[],
	enabledIds: string[],
): RequirementReport {
	const enabled = templates.filter((t) => enabledIds.includes(t.id));
	const collect = (reqs: Requirement[] | undefined, tpl: ServiceTemplate) =>
		(reqs ?? []).flatMap((req) => {
			const reason = unmetReason(tpl, req, enabled, templates);
			if (reason === null) return [];
			return [{ service: tpl.id, category: req.category, reason }];
		});

	return {
		missing: enabled.flatMap((t) => collect(t.requires, t)),
		warnings: enabled.flatMap((t) => collect(t.recommends, t)),
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
 * One sentence per unmet need. The wording belongs to the template when it knows
 * what to say, and is generated when it cannot — a template cannot guess which
 * unsupported peer someone would pick.
 */
export function requirementMessage(unmet: UnmetRequirement[]): string {
	return unmet
		.map((u) => u.reason ?? `${u.service} requires a "${u.category}" service.`)
		.join(" ");
}
