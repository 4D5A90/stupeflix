export interface FieldRules {
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	message?: string;
}

export interface SelectOption {
	value: string;
	label: string;
}

export interface CredentialField {
	key: string;
	type: "text" | "password" | "email" | "select";
	label: string;
	/** `select` only; the list is declared by the template. */
	options?: SelectOption[];
	default?: string;
	/** Shown greyed inside the empty field, when a default would be wrong. */
	placeholder?: string;
	/** `password` only; `false` when the secret must match one held elsewhere. */
	generate?: boolean;
	required?: boolean;
	rules?: FieldRules;
}

/** A need expressed as a category, so no service ever names another. */
export interface Requirement {
	category: string;
	reason?: string;
}

export interface ServiceMeta {
	id: string;
	name: string;
	description: string;
	category: string;
	defaultEnabled: boolean;
	notes: string[];
	requires: Requirement[];
	recommends: Requirement[];
	credentials: CredentialField[];
}

/** A named set of services someone has already proved works together. */
export interface Stack {
	id: string;
	name: string;
	description: string;
	services: string[];
}

export interface UnmetRequirement {
	service: string;
	category: string;
	reason?: string;
}

/**
 * Mirrors the API's own check (`lib/requirements.ts`) so the wizard can react as
 * the user toggles, with no round trip. The API stays the authority — it runs
 * the same check before it does anything — and this is only the fast feedback.
 */
export function checkRequirements(
	registry: ServiceMeta[],
	isEnabled: (id: string) => boolean,
): { missing: UnmetRequirement[]; warnings: UnmetRequirement[] } {
	const enabled = registry.filter((s) => isEnabled(s.id));
	const covered = new Set(enabled.map((s) => s.category));
	const unmet = (svc: ServiceMeta, reqs: Requirement[] = []) =>
		reqs
			.filter((r) => !covered.has(r.category))
			.map((r) => ({
				service: svc.id,
				category: r.category,
				reason: r.reason,
			}));
	return {
		missing: enabled.flatMap((s) => unmet(s, s.requires)),
		warnings: enabled.flatMap((s) => unmet(s, s.recommends)),
	};
}

// Categories where only one service can be selected
const SINGLE_SELECT_CATEGORIES = ["torrentClient", "vpn"];

export function isSingleSelect(category: string): boolean {
	return SINGLE_SELECT_CATEGORIES.includes(category);
}

export interface Library {
	name: string;
	type: "movies" | "tvshows" | "music";
}

export const DEFAULT_LIBRARIES: Library[] = [
	{ name: "Movies", type: "movies" },
	{ name: "TvShows", type: "tvshows" },
];

export interface SetupConfig {
	paths: {
		config: string;
		media: string;
		torrents: string;
	};
	libraries: Library[];
	credentials: Record<string, Record<string, string>>;
	services: Record<string, { enabled: boolean }>;
}

export type StepStatus = "pending" | "in_progress" | "completed" | "failed";

export interface SetupStatus {
	global: StepStatus;
	steps: Record<string, StepStatus>;
	error: string | null;
}

export type StepId = "paths" | "credentials" | "services" | "progress";

export function buildDefaultConfig(registry: ServiceMeta[]): SetupConfig {
	const services: Record<string, { enabled: boolean }> = {};
	const credentials: Record<string, Record<string, string>> = {};
	for (const svc of registry) {
		services[svc.id] = { enabled: svc.defaultEnabled };
		if (svc.credentials.length > 0) {
			credentials[svc.id] = {};
			for (const field of svc.credentials) {
				credentials[svc.id][field.key] = field.default ?? "";
			}
		}
	}
	return {
		paths: { config: "", media: "", torrents: "" },
		libraries: [...DEFAULT_LIBRARIES],
		credentials,
		services,
	};
}
