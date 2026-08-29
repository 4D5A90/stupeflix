import { execSync } from "node:child_process";
import { Hono } from "hono";
import type { Db } from "../db.js";
import { compose } from "../lib/docker-cli.js";
import { getTemplates } from "../lib/service-registry.js";

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
