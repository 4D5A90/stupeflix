import type { Db } from "../db.js";
import { PGID, PUID, TZ } from "./env.js";
import { debug } from "./logger.js";

export interface Library {
	name: string;
	type: string;
}

/**
 * Where `paths.media` is mounted inside every service container. Templates bind
 * it there, so a library the user calls `Movies` is `/media/Movies` for qBittorrent,
 * Jellyfin and Sonarr alike — that shared view is what lets them agree on a
 * file without any service knowing about the others.
 */
export const CONTAINER_MEDIA_ROOT = "/media";

/** Library types the wizard can produce, so `{{libraries.<type>_json}}` is never undefined. */
const KNOWN_LIBRARY_TYPES = ["movies", "tvshows", "music"];

const DEFAULT_LIBRARIES: Library[] = [
	{ name: "Movies", type: "movies" },
	{ name: "TvShows", type: "tvshows" },
];

export function getLibraries(db: Db): Library[] {
	const raw = db.get("libraries") as string;
	if (!raw) return DEFAULT_LIBRARIES;
	try {
		return JSON.parse(raw) as Library[];
	} catch {
		return DEFAULT_LIBRARIES;
	}
}

/**
 * Every variable a template may reference:
 *
 * - `{{paths.media}}`, `{{env.PUID}}`            — host wiring
 * - `{{credentials.user}}`, `{{internal.token}}` — the current service's own values
 * - `{{internal.prowlarr.api_key}}`              — another service's value, which is
 *   how two templates connect without either one being named in the code
 * - `{{libraries.movies_json}}`                  — `[{"name":…,"path":"/media/…"}]`
 */
export function buildVars(db: Db, serviceId?: string): Record<string, string> {
	const all = db.all();
	const vars: Record<string, string> = {
		"env.PUID": PUID,
		"env.PGID": PGID,
		"env.TZ": TZ,
	};

	for (const key of ["config", "media", "torrents"]) {
		vars[`paths.${key}`] = (all[`paths.${key}`] as string) ?? "";
	}

	const libraries = getLibraries(db);
	const types = new Set([
		...KNOWN_LIBRARY_TYPES,
		...libraries.map((l) => l.type),
	]);
	for (const type of types) {
		const entries = libraries
			.filter((l) => l.type === type)
			.map((l) => ({
				name: l.name,
				path: `${CONTAINER_MEDIA_ROOT}/${l.name}`,
			}));
		vars[`libraries.${type}_json`] = JSON.stringify(entries);
	}

	// Fully qualified first, so any service can read another's credentials or secrets
	for (const [key, value] of Object.entries(all)) {
		if (key.startsWith("services.") && key.endsWith(".enabled")) {
			// Lets a template switch on a peer it integrates with, e.g.
			// A step that wires a peer disappears when the peer is not installed
			vars[key] = value ? "true" : "false";
			continue;
		}
		if (typeof value !== "string") continue;
		if (key.startsWith("credentials.") || key.startsWith("internal.")) {
			vars[key] = value;
		}
	}

	// Then the current service's own values, unprefixed
	if (serviceId) {
		for (const prefix of ["credentials", "internal"]) {
			const full = `${prefix}.${serviceId}.`;
			for (const [key, value] of Object.entries(all)) {
				if (typeof value !== "string" || !key.startsWith(full)) continue;
				vars[`${prefix}.${key.slice(full.length)}`] = value;
			}
		}
	}

	return vars;
}

export function resolveTemplateVars(
	value: unknown,
	vars: Record<string, string>,
): unknown {
	if (typeof value === "string") {
		return value.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, key: string) => {
			if (key in vars) return vars[key];
			debug(`Unresolved template variable ${match}`);
			return "";
		});
	}
	if (Array.isArray(value)) {
		return value.map((v) => resolveTemplateVars(v, vars));
	}
	if (value !== null && typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			result[k] = resolveTemplateVars(v, vars);
		}
		return result;
	}
	return value;
}
