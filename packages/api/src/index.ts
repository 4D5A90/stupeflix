import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { initDb } from "./db.js";
import { PORT, ROOT, SERVICE_HOST, TEMPLATES_DIR, WEB_DIR } from "./lib/env.js";
import { getLibraryStats } from "./lib/library-stats.js";
import {
	getServiceMetas,
	getTemplate,
	getTemplateDefaults,
	getTemplateFiles,
	getTemplates,
	getTemplatesDir,
	loadTemplates,
	reloadTemplates,
	runSetupStep,
} from "./lib/service-registry.js";
import { dockerRoutes } from "./routes/docker.js";
import { installRoutes } from "./routes/install.js";
import { servicesRoutes } from "./routes/services.js";
import { settingsRoutes } from "./routes/settings.js";
import { setupRoutes } from "./routes/setup.js";

loadTemplates(
	TEMPLATES_DIR ?? resolve(import.meta.dirname, "../../../templates"),
);

const db = await initDb(getTemplateDefaults());

// If the server restarted mid-setup or mid-install, unlock the state
if (db.get("setup.global") === "in_progress") {
	db.set("setup.global", "failed");
	db.set("setup.error", "Server was restarted during setup");
}

const api = new Hono();

api.get("/health", (c) => c.json({ status: "ok" }));

/** Runtime environment, so the wizard can prefill paths when a host root is mounted. */
api.get("/runtime", (c) => c.json({ root: ROOT, serviceHost: SERVICE_HOST }));

api.get("/registry", (c) => c.json(getServiceMetas()));

/**
 * Filesystem view of the libraries, so the dashboard can lead with what the user
 * has rather than with which containers happen to run. Read from disk on purpose:
 * it stays true with every media server stopped, and picks no canonical one.
 */
api.get("/library/stats", (c) => c.json(getLibraryStats(db)));

api.get("/templates", (c) => {
	const files = getTemplateFiles();
	const templates = getTemplates().map((t) => ({
		id: t.id,
		name: t.name,
		category: t.category,
		file:
			files.find((f) => f.replace(/\.ya?ml$/, "") === t.id) ?? `${t.id}.yml`,
	}));
	return c.json(templates);
});

api.post("/templates/reload", (c) => {
	reloadTemplates();
	return c.json({ success: true, count: getTemplates().length });
});

api.post("/templates/upload", async (c) => {
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

api.get("/status", (c) => {
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

api.get("/credentials", (c) => {
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

/**
 * Runs a template-declared action (`actions.<name>`) — no service is named here.
 * The `/actions/` segment keeps these clear of the fixed container verbs
 * (`start`, `stop`, `restart`, `logs`) served under /services.
 */
api.post("/services/:name/actions/:action", async (c) => {
	const tpl = getTemplate(c.req.param("name"));
	if (!tpl) return c.json({ error: "Service not found" }, 404);

	const step = tpl.actions?.[c.req.param("action")];
	if (!step)
		return c.json({ error: "Action not supported for this service" }, 400);

	const err = await runSetupStep(step, db, tpl.id);
	return err ? c.json({ error: err }, 400) : c.json({ success: true });
});

api.route("/settings", settingsRoutes(db));
api.route("/setup", setupRoutes(db));
api.route("/docker", dockerRoutes(db));
api.route("/services", servicesRoutes(db));
api.route("/install", installRoutes(db));

const app = new Hono();

app.use("*", logger());
app.use("*", cors());

app.onError((err, c) => {
	console.error(err);
	return c.json({ error: err.message }, 500);
});

// Mounted twice: at the root for `pnpm dev` (Vite strips the /api prefix when proxying),
// and under /api for the packaged build where the API also serves the frontend.
app.route("/", api);
app.route("/api", api);

if (WEB_DIR) {
	app.use("/*", serveStatic({ root: WEB_DIR }));
	// SPA fallback — any unmatched route renders the wizard
	app.get("*", serveStatic({ path: "index.html", root: WEB_DIR }));
}

serve({ fetch: app.fetch, port: PORT });
console.log(`Stupeflix running on http://localhost:${PORT}`);
