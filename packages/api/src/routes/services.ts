import { execSync } from "node:child_process";
import { Hono } from "hono";
import type { Db } from "../db.js";
import { compose } from "../lib/docker-cli.js";
import { readServiceInfo } from "../lib/service-info.js";
import { removeService, runServiceInstall } from "../lib/service-install.js";
import { getTemplate, getTemplates } from "../lib/service-registry.js";
import { setStepStatus, stepKeys } from "../lib/setup-runner.js";

function getContainerStatus(container: string): string {
	try {
		return execSync(
			`docker inspect -f '{{.State.Status}}' ${container} 2>/dev/null`,
			{
				encoding: "utf-8",
			},
		).trim();
	} catch {
		return "not_found";
	}
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
						return tpl.credentials.find((f) => f.key === key)?.default ?? "";
					},
				);
			}
			return {
				name: tpl.id,
				label: tpl.name,
				enabled: s[`services.${tpl.id}.enabled`] ?? false,
				status: getContainerStatus(tpl.container),
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
		const name = c.req.param("name");
		execSync(compose(`start ${name}`), { stdio: "inherit" });
		return c.json({ success: true });
	});

	app.post("/:name/stop", (c) => {
		const name = c.req.param("name");
		execSync(compose(`stop ${name}`), { stdio: "inherit" });
		return c.json({ success: true });
	});

	app.post("/:name/restart", (c) => {
		const name = c.req.param("name");
		execSync(compose(`restart ${name}`), { stdio: "inherit" });
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

		const body = await c.req.json().catch(() => ({}));
		const credentials: Record<string, string> = body.credentials ?? {};
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
		const name = c.req.param("name");
		const lines = c.req.query("lines") ?? "100";
		const logs = execSync(compose(`logs --tail=${lines} ${name}`), {
			encoding: "utf-8",
		});
		return c.json({ logs });
	});

	return app;
}
