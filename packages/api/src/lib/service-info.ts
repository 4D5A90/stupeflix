import type { Db } from "../db.js";
import { serviceUrl } from "./env.js";
import type { InfoField, ServiceTemplate } from "./service-registry.js";
import { buildVars, resolveTemplateVars } from "./template-vars.js";

/**
 * Values a service reports about itself, for the dashboard to show.
 *
 * Distinct from `actions:` on purpose: an action *does* something and returns
 * nothing, a readout *is* something and does nothing. A VPN's exit IP, a media
 * server's version — the question a card should answer beyond "running".
 *
 * Read server-side rather than from the browser, because a container's address
 * depends on where the API itself runs — the same reason `serviceUrl()` exists.
 */

/** A service that is down must read as unknown, never as an error. */
const TIMEOUT_MS = 3000;

/** Walks a dotted path — `public_ip`, `data.version`. No expressions. */
function extractPath(body: unknown, path: string): unknown {
	let value = body;
	for (const key of path.split(".")) {
		if (value === null || typeof value !== "object") return undefined;
		value = (value as Record<string, unknown>)[key];
	}
	return value;
}

export async function readInfoField(
	db: Db,
	tpl: ServiceTemplate,
	field: InfoField,
): Promise<string | null> {
	const vars = buildVars(db, tpl.id);
	const url = serviceUrl(resolveTemplateVars(field.url, vars) as string);
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
		if (!res.ok) return null;
		if (!field.extract) return (await res.text()).trim() || null;

		const value = extractPath(await res.json(), field.extract);
		// A path that misses reads as unknown too: a template pointing at the
		// wrong key must degrade, not break the card
		if (value === null || value === undefined) return null;
		return typeof value === "object" ? null : String(value);
	} catch {
		return null;
	}
}

/** Every readout a template declares. Fields are independent, so one failing does not hide the rest. */
export async function readServiceInfo(
	db: Db,
	tpl: ServiceTemplate,
): Promise<Record<string, string | null>> {
	const fields = tpl.info ?? [];
	const values = await Promise.all(
		fields.map((field) => readInfoField(db, tpl, field)),
	);
	return Object.fromEntries(fields.map((field, i) => [field.name, values[i]]));
}
