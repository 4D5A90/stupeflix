import type { CredentialField, ServiceTemplate } from "./service-registry.js";

/**
 * Nothing a service asks for is this long. A credential ends up in a config
 * file, an environment variable and a compose file, and a field with no `rules:`
 * would otherwise take whatever fits in the request body.
 */
const MAX_LENGTH = 512;

/**
 * The `rules:` a template declares, enforced where it counts.
 *
 * This mirrors `web/src/types/setup.ts:validateField`, which answers as the user
 * types with no round trip — **and the API is the authority**, the same
 * arrangement `lib/requirements.ts` has with the wizard, for the same reason: a
 * check that lives only in the frontend is one anyone walks around with curl.
 *
 * It is not cosmetic. A credential is spliced into whatever its template asks
 * for, and the engine escapes for nothing: `templates/qbittorrent.yml` writes
 * `WebUI\Username={{credentials.user}}` into an INI file, so a newline in that
 * value adds an `[AutoRun]` section and qBittorrent then runs a command of the
 * writer's choosing when a download finishes.
 */
export function fieldProblem(
	field: CredentialField,
	value: string,
): string | null {
	// Emptiness is `required:`'s business, not `rules:` — same as the wizard,
	// which would otherwise show an error on every field before it is filled.
	if (!value) return null;
	if (value.length > MAX_LENGTH)
		return `must be at most ${MAX_LENGTH} characters`;
	if (field.type === "select") {
		const options = field.options ?? [];
		if (!options.some((o) => o.value === value)) {
			return "must be one of the offered options";
		}
	}
	const rules = field.rules;
	if (!rules) return null;
	if (rules.minLength && value.length < rules.minLength) {
		return rules.message ?? `must be at least ${rules.minLength} characters`;
	}
	if (rules.maxLength && value.length > rules.maxLength) {
		return rules.message ?? `must be at most ${rules.maxLength} characters`;
	}
	if (rules.pattern && !new RegExp(rules.pattern).test(value)) {
		return rules.message ?? "is not in the expected format";
	}
	return null;
}

/**
 * Every reason this set of values cannot be stored for this service.
 *
 * A key the template does not declare is refused rather than ignored: the key
 * is concatenated into `credentials.<id>.<key>`, so accepting one would let a
 * caller write settings no wizard screen can show and no template will read.
 */
export function credentialProblems(
	tpl: ServiceTemplate,
	values: unknown,
): string[] {
	if (typeof values !== "object" || values === null || Array.isArray(values)) {
		return [`${tpl.id}: credentials must be a mapping`];
	}
	const fields = new Map((tpl.credentials ?? []).map((f) => [f.key, f]));
	const problems: string[] = [];
	for (const [key, value] of Object.entries(values)) {
		const field = fields.get(key);
		if (!field) {
			problems.push(`${tpl.id}.${key} is not a field this service declares`);
			continue;
		}
		if (typeof value !== "string") {
			problems.push(`${tpl.id}.${key} must be text`);
			continue;
		}
		const problem = fieldProblem(field, value);
		if (problem) problems.push(`${tpl.id}.${key} ${problem}`);
	}
	return problems;
}
