import { writeFileSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { parse } from "yaml";
import { initDb } from "./db.js";
import { accessToken, tokenGate } from "./lib/auth.js";
import { runDockerSync } from "./lib/docker-cli.js";
import {
	HOST,
	PORT,
	ROOT,
	SERVICE_HOST,
	STACKS_DIR,
	TEMPLATES_DIR,
	TOKEN,
	WEB_DIR,
} from "./lib/env.js";
import { getLibraryStats } from "./lib/library-stats.js";
import {
	SKIPPED,
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
import { getStacks, loadStacks, reloadStacks } from "./lib/stacks.js";
import { validateTemplate } from "./lib/template-schema.js";
import { dockerRoutes } from "./routes/docker.js";
import { installRoutes } from "./routes/install.js";
import { servicesRoutes } from "./routes/services.js";
import { settingsRoutes } from "./routes/settings.js";
import { setupRoutes } from "./routes/setup.js";

loadTemplates(
	TEMPLATES_DIR ?? resolve(import.meta.dirname, "../../../templates"),
);
loadStacks(STACKS_DIR ?? resolve(import.meta.dirname, "../../../stacks"));

const db = await initDb(getTemplateDefaults());

// If the server restarted mid-setup or mid-install, unlock the state
if (db.get("setup.global") === "in_progress") {
	db.set("setup.global", "failed");
	db.set("setup.error", "Server was restarted during setup");
}

const api = new Hono();

// Before every route below, and on `api` rather than on the outer app: `api` is
// mounted at both prefixes, and the outer app also serves the wizard — gating
// that would gate the screen that asks for the token.
api.use("*", tokenGate(accessToken(db)));

api.get("/health", (c) => c.json({ status: "ok" }));

/** Runtime environment, so the wizard can prefill paths when a host root is mounted. */
api.get("/runtime", (c) => c.json({ root: ROOT, serviceHost: SERVICE_HOST }));

api.get("/registry", (c) => c.json(getServiceMetas()));

// Its own route rather than a key inside /registry: a stack is not a service,
// and the wizard asks one question of this list — is it empty.
api.get("/stacks", (c) => c.json(getStacks()));

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
	reloadStacks();
	return c.json({ success: true, count: getTemplates().length });
});

/**
 * Uploading a template is uploading code: it declares the containers this API
 * starts and the requests it makes on the operator's behalf.
 *
 * So the multipart filename is reduced to a basename and matched against a
 * shape — `resolve(dir, "../../../etc/cron.d/x.yml")` used to be honoured — and
 * the content is validated *before* anything is written. A refused template must
 * leave nothing on disk: the loader would otherwise pick it up on the next boot.
 */
api.post("/templates/upload", async (c) => {
	const body = await c.req.parseBody();
	const file = body.file;
	if (!(file instanceof File)) {
		return c.json({ error: "No file provided" }, 400);
	}
	const name = basename(file.name);
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/.test(name)) {
		return c.json({ error: "File must be named <id>.yml" }, 400);
	}
	const dir = resolve(getTemplatesDir());
	const target = join(dir, name);
	// The shape above already forbids a separator; this is the invariant itself,
	// and it is what stays true if that expression is ever loosened.
	if (!target.startsWith(dir + sep)) {
		return c.json({ error: "File must be named <id>.yml" }, 400);
	}

	const content = await file.text();
	let parsed: unknown;
	try {
		parsed = parse(content);
	} catch (e) {
		const detail = e instanceof Error ? e.message : String(e);
		return c.json({ error: `Not valid YAML: ${detail}` }, 400);
	}
	const problems = validateTemplate(parsed);
	if (problems.length > 0) {
		return c.json({ error: problems.join("; "), problems }, 400);
	}

	writeFileSync(target, content);
	reloadTemplates();
	return c.json({ success: true, count: getTemplates().length });
});

api.get("/status", (c) => {
	const setupCompleted = db.get("setup.completed");
	const containers: Record<string, string> = {};

	for (const tpl of getTemplates()) {
		try {
			containers[tpl.id] = runDockerSync([
				"inspect",
				"-f",
				"{{.State.Status}}",
				tpl.container,
			]).trim();
		} catch {
			containers[tpl.id] = "not_found";
		}
	}

	return c.json({ setup_completed: setupCompleted, containers });
});

/**
 * Every stored credential, for the dashboard's copy-password button. Behind the
 * token like everything else — the operator reading their own qBittorrent
 * password is the point; anyone else reading it was the bug.
 *
 * Built on null-prototype objects: the service id is a key segment a caller
 * chooses, and `result["__proto__"]` used to be truthy, so the field beneath it
 * landed on `Object.prototype` for the whole process.
 */
api.get("/credentials", (c) => {
	const all = db.all();
	const result: Record<string, Record<string, string>> = Object.create(null);
	for (const [key, value] of Object.entries(all)) {
		if (!key.startsWith("credentials.") || typeof value !== "string") continue;
		const [, serviceId, field] = key.split(".");
		if (!serviceId || !field) continue;
		if (!Object.hasOwn(result, serviceId))
			result[serviceId] = Object.create(null);
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
	return err && err !== SKIPPED
		? c.json({ error: err }, 400)
		: c.json({ success: true });
});

api.route("/settings", settingsRoutes(db));
api.route("/setup", setupRoutes(db));
api.route("/docker", dockerRoutes(db));
api.route("/services", servicesRoutes(db));
api.route("/install", installRoutes(db));

const app = new Hono();

app.use("*", logger());

/*
 * No `cors()`. The browser is same-origin in both mounts — Vite proxies /api in
 * dev, the image serves the wizard itself in production — so the wildcard it
 * used to install bought nothing and handed every website the operator visits a
 * working client for this API.
 *
 * No `csrf()` either, and that is a decision rather than an omission: the gate
 * is a bearer token, and a cross-origin page cannot set an `Authorization`
 * header without a preflight this API never answers. A forged form POST arrives
 * without the token and is refused as 401 like any other anonymous request.
 * Adding the middleware would only refuse `curl -d` for having no Origin — see
 * the README's throwaway-stack recipe, which drives the API by hand.
 */
app.use(
	"*",
	secureHeaders({
		contentSecurityPolicy: {
			defaultSrc: ["'self'"],
			scriptSrc: ["'self'"],
			// Four components size a bar or a grid from a value only known at
			// render time (`LibraryTiles.tsx:74`, `ProgressStep.tsx:132`); those
			// are style attributes, and a CSP without this refuses them.
			styleSrc: ["'self'", "'unsafe-inline'"],
			// Vite inlines the smaller service icons as data URIs.
			imgSrc: ["'self'", "data:"],
			connectSrc: ["'self'"],
			objectSrc: ["'none'"],
			baseUri: ["'self'"],
			formAction: ["'self'"],
			frameAncestors: ["'none'"],
		},
	}),
);

app.onError((err, c) => {
	console.error(err);
	// An HTTPException carries a status and a message a route meant to send; an
	// unexpected throw carries whatever the runtime put in it — for a failed
	// `docker compose`, the whole command line and the host paths in it.
	if (err instanceof HTTPException) return err.getResponse();
	return c.json({ error: "Internal error" }, 500);
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

serve({ fetch: app.fetch, port: PORT, hostname: HOST });
console.log(`Stupeflix running on http://localhost:${PORT}`);
console.log(
	TOKEN
		? "Access token: pinned by STUPEFLIX_TOKEN"
		: `Access token: ${accessToken(db)}`,
);
