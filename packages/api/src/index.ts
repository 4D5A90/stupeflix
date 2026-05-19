import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { initDb } from "./db.js";
import { loadTemplates, getTemplates, getServiceMetas, reloadTemplates, getTemplateFiles } from "./lib/service-registry.js";
import { dockerRoutes } from "./routes/docker.js";
import { servicesRoutes } from "./routes/services.js";
import { settingsRoutes } from "./routes/settings.js";
import { setupRoutes } from "./routes/setup.js";

loadTemplates(resolve(import.meta.dirname, "../../../templates"));

const db = await initDb();
const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.onError((err, c) => {
	console.error(err);
	return c.json({ error: err.message }, 500);
});

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/registry", (c) => c.json(getServiceMetas()));

app.get("/templates", (c) => {
	const files = getTemplateFiles();
	const templates = getTemplates().map((t) => ({
		id: t.id,
		name: t.name,
		category: t.category,
		file: files.find((f) => f.replace(/\.ya?ml$/, "") === t.id) ?? `${t.id}.yml`,
	}));
	return c.json(templates);
});

app.post("/templates/reload", (c) => {
	reloadTemplates();
	return c.json({ success: true, count: getTemplates().length });
});

app.post("/templates/upload", async (c) => {
	const body = await c.req.parseBody();
	const file = body.file;
	if (!(file instanceof File)) {
		return c.json({ error: "No file provided" }, 400);
	}
	if (!file.name.endsWith(".yml") && !file.name.endsWith(".yaml")) {
		return c.json({ error: "File must be .yml or .yaml" }, 400);
	}
	const content = await file.text();
	const { writeFileSync } = await import("node:fs");
	writeFileSync(resolve(getTemplatesDir(), file.name), content);
	reloadTemplates();
	return c.json({ success: true, count: getTemplates().length });
});

app.get("/status", (c) => {
	const setupCompleted = db.get("setup.completed");
	const containers: Record<string, string> = {};

	for (const tpl of getTemplates()) {
		try {
			containers[tpl.id] = execSync(
				`docker inspect -f '{{.State.Status}}' ${tpl.container} 2>/dev/null`,
				{ encoding: "utf-8" },
			).trim();
		} catch {
			containers[tpl.id] = "not_found";
		}
	}

	return c.json({ setup_completed: setupCompleted, containers });
});

app.get("/credentials", (c) => {
	const all = db.all();
	const result: Record<string, Record<string, string>> = {};
	for (const [key, value] of Object.entries(all)) {
		if (!key.startsWith("credentials.") || typeof value !== "string") continue;
		const parts = key.split(".");
		const serviceId = parts[1];
		const field = parts[2];
		if (!result[serviceId]) result[serviceId] = {};
		result[serviceId][field] = value;
	}
	return c.json(result);
});

app.post("/services/:name/scan", async (c) => {
	const name = c.req.param("name");
	const tpl = getTemplates().find((t) => t.id === name);
	if (!tpl) return c.json({ error: "Service not found" }, 404);

	if (name === "jellyfin") {
		const token = db.get("internal.jellyfin.token") as string;
		if (!token) return c.json({ error: "No auth token, reconfigure Jellyfin" }, 400);
		const res = await fetch("http://127.0.0.1:8096/Library/Refresh", {
			method: "POST",
			headers: { Authorization: `MediaBrowser Token="${token}"` },
		});
		return c.json({ success: res.ok });
	}

	if (name === "plex") {
		const token = db.get("internal.plex.token") as string;
		if (!token) return c.json({ error: "No auth token, reconfigure Plex" }, 400);
		const res = await fetch("http://127.0.0.1:32400/library/sections/all/refresh", {
			headers: { "X-Plex-Token": token },
		});
		return c.json({ success: res.ok });
	}

	if (name === "emby") {
		const token = db.get("internal.emby.token") as string;
		if (!token) return c.json({ error: "No auth token, reconfigure Emby" }, 400);
		const res = await fetch("http://127.0.0.1:8096/Library/Refresh", {
			method: "POST",
			headers: { "X-Emby-Token": token },
		});
		return c.json({ success: res.ok });
	}

	return c.json({ error: "Scan not supported for this service" }, 400);
});

app.route("/settings", settingsRoutes(db));
app.route("/setup", setupRoutes(db));
app.route("/docker", dockerRoutes(db));
app.route("/services", servicesRoutes(db));

serve({ fetch: app.fetch, port: 3000 });
console.log("Stupeflix API running on http://localhost:3000");
