import { execSync } from "node:child_process";
import { Hono } from "hono";
import type { Db } from "../db.js";
import { getTemplates } from "../lib/service-registry.js";

function getContainerStatus(container: string): string {
	try {
		return execSync(`docker inspect -f '{{.State.Status}}' ${container} 2>/dev/null`, {
			encoding: "utf-8",
		}).trim();
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
				webUiPath = webUiPath.replace(/\{\{credentials\.(\w+)\}\}/g, (_m, key: string) => {
					const stored = s[`credentials.${tpl.id}.${key}`] as string | undefined;
					if (stored) return stored;
					return tpl.credentials.find((f) => f.key === key)?.default ?? "";
				});
			}
			return {
				name: tpl.id,
				enabled: s[`services.${tpl.id}.enabled`] ?? false,
				status: getContainerStatus(tpl.container),
				port: tpl.port,
				webUiPath: webUiPath || undefined,
			};
		});
		return c.json(services);
	});

	app.post("/:name/start", (c) => {
		const name = c.req.param("name");
		execSync(`docker compose start ${name}`, { stdio: "inherit" });
		return c.json({ success: true });
	});

	app.post("/:name/stop", (c) => {
		const name = c.req.param("name");
		execSync(`docker compose stop ${name}`, { stdio: "inherit" });
		return c.json({ success: true });
	});

	app.post("/:name/restart", (c) => {
		const name = c.req.param("name");
		execSync(`docker compose restart ${name}`, { stdio: "inherit" });
		return c.json({ success: true });
	});

	app.get("/:name/logs", (c) => {
		const name = c.req.param("name");
		const lines = c.req.query("lines") ?? "100";
		const logs = execSync(`docker compose logs --tail=${lines} ${name}`, {
			encoding: "utf-8",
		});
		return c.json({ logs });
	});

	return app;
}
