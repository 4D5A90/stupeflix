import { Hono } from "hono";
import type { Db } from "../db.js";
import { pathProblem } from "../lib/safe-path.js";

/**
 * Settings a caller may write.
 *
 * An allowlist, not a denylist of secrets — and the difference is the whole
 * point. The keys that must never leave or be forged (`credentials.*`,
 * `internal.*`, `auth.token`, `instance.id`) are exactly the ones a template
 * invents at runtime, so a denylist would have to grow every time somebody
 * drops a `.yml` in `templates/`, and it would not.
 *
 * `paths.*` is here because the wizard writes it, and it is also the base of
 * every `join()` this API performs — `lib/safe-path.ts` is what keeps a value
 * written here from pointing the config reset at `/etc`.
 */
const WRITABLE = [
	/^paths\.(config|media|torrents)$/,
	/^libraries$/,
	/^services\.[A-Za-z0-9._-]+\.enabled$/,
];

/** The writable ones, plus the run state the wizard reads back. */
const READABLE = [...WRITABLE, /^setup\.(completed|global|error)$/];

/**
 * A writable key is not a writable value: `paths.*` is the base of every join
 * the engine performs, so it answers to `lib/safe-path.ts` however it is set.
 */
function valueProblem(key: string, value: unknown): string | null {
	return key.startsWith("paths.") ? pathProblem(value) : null;
}

/** A bulk write is a convenience, not a bulk-loading facility. */
const MAX_BATCH = 50;

const readable = (key: string) => READABLE.some((rule) => rule.test(key));
const writable = (key: string) => WRITABLE.some((rule) => rule.test(key));

export function settingsRoutes(db: Db) {
	const app = new Hono();

	app.get("/", (c) => {
		const all = db.all();
		const visible: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(all)) {
			if (readable(key)) visible[key] = value;
		}
		return c.json(visible);
	});

	// 404 rather than a refusal: an answer that distinguishes "not allowed" from
	// "not there" tells a caller which secrets exist.
	app.get("/:key", (c) => {
		const key = c.req.param("key");
		const value = readable(key) ? db.get(key) : null;
		return value !== null
			? c.json({ key, value })
			: c.json({ error: "Not found" }, 404);
	});

	app.put("/:key", async (c) => {
		const key = c.req.param("key");
		if (!writable(key)) return c.json({ error: "Not a writable setting" }, 400);
		const { value } = await c.req.json();
		const problem = valueProblem(key, value);
		if (problem) return c.json({ error: `${key} ${problem}` }, 400);
		db.set(key, value);
		return c.json({ key, value });
	});

	// All or nothing: a partially applied batch leaves the caller guessing which
	// half landed.
	app.put("/", async (c) => {
		const body = await c.req.json();
		const entries = Object.entries(body);
		// `db.set` serialises and rewrites the whole file, so a batch costs one
		// full write per key. There are a handful of writable keys in all.
		if (entries.length > MAX_BATCH) {
			return c.json({ error: `At most ${MAX_BATCH} settings at a time` }, 400);
		}
		const refused = entries.filter(([key]) => !writable(key)).map(([k]) => k);
		if (refused.length > 0) {
			return c.json({ error: "Not a writable setting", refused }, 400);
		}
		for (const [key, value] of entries) {
			const problem = valueProblem(key, value);
			if (problem) return c.json({ error: `${key} ${problem}` }, 400);
		}
		for (const [key, value] of entries) db.set(key, value);
		return c.json({ updated: entries.length });
	});

	app.delete("/:key", (c) => {
		const key = c.req.param("key");
		if (!writable(key)) return c.json({ error: "Not a writable setting" }, 400);
		db.delete(key);
		return c.json({ deleted: true });
	});

	return app;
}
