import { Hono } from "hono";
import type { Db } from "../db.js";
import { containerStatus } from "../lib/container-status.js";
import { credentialProblems } from "../lib/credential-rules.js";
import { runComposeSync } from "../lib/docker-cli.js";
import { ownershipConflict } from "../lib/instance.js";
import { readServiceInfo } from "../lib/service-info.js";
import { removeService, runServiceInstall } from "../lib/service-install.js";
import { getTemplate, getTemplates } from "../lib/service-registry.js";
import { setStepStatus, stepKeys } from "../lib/setup-runner.js";

/**
 * The container these fixed verbs act on.
 *
 * Resolving the path param through `getTemplate` is what the reconfigure,
 * delete and info routes already did, and what these four did not: the raw
 * param used to reach the command line. It stays a check of its own even now
 * that nothing is shelled out — driving a container this install does not own
 * is not something the API should offer either.
 */
function containerOf(name: string): string | null {
	return getTemplate(name)?.container ?? null;
}

/**
 * `--tail` takes a count. Anything else is a caller error, not a value to pass
 * on and let docker rule about.
 */
function tailLines(raw: string | undefined): number | null {
	const text = raw ?? "100";
	// Digits and nothing else. `Number.parseInt` reads a prefix and drops the
	// rest, so it accepts `1e3` as 1 and `100; rm -rf /` as 100 — a value that
	// looks validated and is not.
	if (!/^\d+$/.test(text)) return null;
	const lines = Number(text);
	return lines > 0 && lines <= 10000 ? lines : null;
}

export function servicesRoutes(db: Db) {
	const app = new Hono();

	app.get("/", (c) => {
		const s = db.all();
		const services = getTemplates().map((tpl) => {
			let webUiPath = tpl.webUiPath ?? "";
			if (webUiPath) {
				webUiPath = webUiPath.replace(
					/\{\{credentials\.(\w+)\}\}/g,
					(_m, key: string) => {
						const stored = s[`credentials.${tpl.id}.${key}`] as
							| string
							| undefined;
						if (stored) return stored;
						return tpl.credentials?.find((f) => f.key === key)?.default ?? "";
					},
				);
			}
			return {
				name: tpl.id,
				label: tpl.name,
				enabled: s[`services.${tpl.id}.enabled`] ?? false,
				status: containerStatus(tpl.container),
				port: tpl.port,
				webUiPath: webUiPath || undefined,
				// Lets the dashboard offer a button per declared action without
				// carrying its own list of which services can do what — the label
				// and icon travel with it so adding an action stays a template edit
				actions: Object.entries(tpl.actions ?? {}).map(([id, action]) => ({
					id,
					label: action.label,
					icon: action.icon,
				})),
				// Names and labels only: the URL is the API's business, not the browser's
				info: (tpl.info ?? []).map(({ name, label, refresh }) => ({
					name,
					label,
					refresh,
				})),
				notes: tpl.notes ?? [],
			};
		});
		return c.json(services);
	});

	app.post("/:name/start", (c) => {
		const container = containerOf(c.req.param("name"));
		if (!container) return c.json({ error: "Template not found" }, 404);
		runComposeSync(["start", container], { inherit: true });
		return c.json({ success: true });
	});

	app.post("/:name/stop", (c) => {
		const container = containerOf(c.req.param("name"));
		if (!container) return c.json({ error: "Template not found" }, 404);
		runComposeSync(["stop", container], { inherit: true });
		return c.json({ success: true });
	});

	app.post("/:name/restart", (c) => {
		const container = containerOf(c.req.param("name"));
		if (!container) return c.json({ error: "Template not found" }, 404);
		runComposeSync(["restart", container], { inherit: true });
		return c.json({ success: true });
	});

	/**
	 * Replays one service's template: same pipeline as an install, with its own
	 * generated config dropped first. Scoped to this service — reconfiguring
	 * Jellyfin leaves Plex's startup wizard alone.
	 */
	app.post("/:name/reconfigure", async (c) => {
		const name = c.req.param("name");
		const tpl = getTemplate(name);
		if (!tpl) return c.json({ error: "Template not found" }, 404);
		if (!db.get(`services.${name}.enabled`))
			return c.json({ error: "Not installed" }, 409);
		if (db.get("setup.global") === "in_progress")
			return c.json({ error: "Setup already in progress" }, 409);

		const conflict = await ownershipConflict(db);
		if (conflict) return c.json({ error: conflict }, 409);

		const body = await c.req.json().catch(() => ({}));
		const credentials: Record<string, string> = body.credentials ?? {};
		const problems = credentialProblems(tpl, credentials);
		if (problems.length > 0) {
			return c.json({ error: problems.join("; "), problems }, 400);
		}
		for (const [key, value] of Object.entries(credentials)) {
			db.set(`credentials.${name}.${key}`, value);
		}
		db.set("setup.error", null);
		for (const key of stepKeys(db, tpl)) setStepStatus(db, key, "pending");

		runServiceInstall(db, tpl, { reset: true });
		return c.json({ success: true });
	});

	app.delete("/:name", async (c) => {
		const name = c.req.param("name");
		const tpl = getTemplate(name);
		if (!tpl) return c.json({ error: "Template not found" }, 404);
		if (db.get("setup.global") === "in_progress")
			return c.json({ error: "Setup in progress" }, 409);

		// The destructive one: `--remove-orphans` would collect the services
		// another instance installed, since the compose project is shared.
		const conflict = await ownershipConflict(db);
		if (conflict) return c.json({ error: conflict }, 409);

		await removeService(db, tpl);
		return c.json({ success: true });
	});

	/** Values the template declares reading off the service itself. */
	app.get("/:name/info", async (c) => {
		const tpl = getTemplate(c.req.param("name"));
		if (!tpl) return c.json({ error: "Template not found" }, 404);
		return c.json(await readServiceInfo(db, tpl));
	});

	app.get("/:name/logs", (c) => {
		const container = containerOf(c.req.param("name"));
		if (!container) return c.json({ error: "Template not found" }, 404);
		const lines = tailLines(c.req.query("lines"));
		if (lines === null) return c.json({ error: "Invalid line count" }, 400);
		const logs = runComposeSync(["logs", "--tail", String(lines), container]);
		return c.json({ logs });
	});

	return app;
}
