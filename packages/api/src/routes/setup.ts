import { existsSync } from "node:fs";
import { Hono } from "hono";
import type { Db } from "../db.js";
import { writeCompose } from "../lib/compose.js";
import { runCompose } from "../lib/docker-cli.js";
import { COMPOSE_FILE } from "../lib/env.js";
import {
	cleanConfigs,
	createMediaDirs,
	createTemplateDirs,
} from "../lib/helpers.js";
import { ownershipConflict } from "../lib/instance.js";
import { debug, error, log } from "../lib/logger.js";
import { checkRequirements, requirementMessage } from "../lib/requirements.js";
import { getEnabledTemplates, getTemplates } from "../lib/service-registry.js";
import {
	type StepStatus,
	runTemplateSteps,
	setStepStatus,
	stepKeys,
	stepRuns,
} from "../lib/setup-runner.js";
import type { Library } from "../lib/template-vars.js";

/** The two steps no template owns: they are the runner's own. */
const GLOBAL_STEP_LABELS: Record<string, string> = {
	compose: "Generate Docker Compose",
	containers: "Start containers",
};

function getSteps(db: Db): string[] {
	const steps = ["compose", "containers"];
	for (const tpl of getEnabledTemplates(db)) {
		steps.push(...stepKeys(db, tpl));
	}
	return steps;
}

function getStatus(db: Db): Record<string, StepStatus> {
	const result: Record<string, StepStatus> = {};
	for (const step of getSteps(db)) {
		result[step] = (db.get(`setup.status.${step}`) as StepStatus) || "pending";
	}
	return result;
}

/**
 * What to call each step on screen. The templates already carry it — without
 * this the frontend can only title-case the key, and shows "Create User" where
 * the template says "Create admin user".
 */
function getLabels(db: Db): Record<string, string> {
	const labels: Record<string, string> = { ...GLOBAL_STEP_LABELS };
	for (const tpl of getEnabledTemplates(db)) {
		for (const run of stepRuns(db, tpl)) labels[run.key] = run.label;
	}
	return labels;
}

function resetStatus(db: Db) {
	for (const step of getSteps(db)) {
		setStepStatus(db, step, "pending");
	}
	db.set("setup.global", "pending");
	db.set("setup.error", null);
}

async function runSetup(db: Db) {
	try {
		db.set("setup.global", "in_progress");

		// Reset if re-running
		if (existsSync(COMPOSE_FILE)) {
			log("Stopping previous containers...");
			try {
				await runCompose(["down", "--timeout", "10"]);
				log("Previous containers stopped");
			} catch (e) {
				debug("docker compose down warning", e);
			}
			cleanConfigs(db);
		}

		// Generate compose, then let every template write the files its container
		// expects to find already there when it boots
		setStepStatus(db, "compose", "in_progress");
		log("Generating docker-compose.yml...");
		writeCompose(db);
		createMediaDirs(db);
		for (const tpl of getEnabledTemplates(db)) {
			createTemplateDirs(db, tpl);
			await runTemplateSteps(db, tpl, "pre_up");
		}
		setStepStatus(db, "compose", "completed");

		// Start containers
		setStepStatus(db, "containers", "in_progress");
		log("Starting containers...");
		const { stdout, stderr } = await runCompose(["up", "-d"]);
		debug("docker compose up", { stdout, stderr });
		setStepStatus(db, "containers", "completed");

		// Then everything that talks to a running service
		for (const tpl of getEnabledTemplates(db)) {
			await runTemplateSteps(db, tpl, "post_up");
		}

		db.set("setup.completed", true);
		db.set("setup.global", "completed");
		log("Setup complete!");
	} catch (e) {
		error("Setup failed", e);
		db.set("setup.global", "failed");
		db.set("setup.error", e instanceof Error ? e.message : String(e));
	}
}

function applyPaths(
	db: Db,
	paths: { config: string; media: string; torrents: string },
) {
	db.set("paths.config", paths.config);
	db.set("paths.media", paths.media);
	db.set("paths.torrents", paths.torrents);
}

function applyLibraries(db: Db, libraries: Library[]) {
	db.set("libraries", JSON.stringify(libraries));
}

function applyCredentials(
	db: Db,
	credentials: Record<string, Record<string, string>>,
) {
	for (const [serviceId, fields] of Object.entries(credentials)) {
		for (const [key, value] of Object.entries(fields)) {
			db.set(`credentials.${serviceId}.${key}`, value);
		}
	}
}

function applyServices(db: Db, services: Record<string, { enabled: boolean }>) {
	for (const [name, cfg] of Object.entries(services)) {
		db.set(`services.${name}.enabled`, cfg.enabled);
	}
}

interface SetupBody {
	paths?: { config: string; media: string; torrents: string };
	libraries?: Library[];
	credentials?: Record<string, Record<string, string>>;
	services?: Record<string, { enabled: boolean }>;
}

/**
 * The database as it *would* be with this configuration applied — reads only.
 *
 * The summary screen has to show the very steps the runner will take, and the
 * step list depends on the config (which services, how many libraries, which
 * `if:` conditions hold). Writing the config to answer that would be worse than
 * useless: the user can still press Back, and the dashboard reads the same keys
 * to decide what is installed.
 */
function withConfig(db: Db, body: SetupBody): Db {
	const patch = new Map<string, unknown>();
	if (body.paths) {
		patch.set("paths.config", body.paths.config);
		patch.set("paths.media", body.paths.media);
		patch.set("paths.torrents", body.paths.torrents);
	}
	if (body.libraries) patch.set("libraries", JSON.stringify(body.libraries));
	for (const [id, fields] of Object.entries(body.credentials ?? {})) {
		for (const [key, value] of Object.entries(fields)) {
			patch.set(`credentials.${id}.${key}`, value);
		}
	}
	for (const [id, cfg] of Object.entries(body.services ?? {})) {
		patch.set(`services.${id}.enabled`, cfg.enabled);
	}
	return {
		get: (key) => (patch.has(key) ? patch.get(key) : db.get(key)),
		all: () => ({ ...db.all(), ...Object.fromEntries(patch) }),
		set: () => {},
		delete: () => {},
	};
}

export function setupRoutes(db: Db) {
	const app = new Hono();

	app.post("/paths", async (c) => {
		applyPaths(db, await c.req.json());
		return c.json({ success: true });
	});

	app.post("/credentials", async (c) => {
		applyCredentials(db, await c.req.json());
		return c.json({ success: true });
	});

	app.post("/services", async (c) => {
		applyServices(db, await c.req.json());
		return c.json({ success: true });
	});

	app.post("/complete", async (c) => {
		const body = await c.req.json().catch(() => ({}));

		// Checked against what was posted, before any of it is stored: a rejected
		// selection must not become the one the wizard reloads into. The wizard
		// blocks this too, but a check living only in the frontend is one anyone
		// can walk around.
		const posted = Object.entries(
			(body.services ?? {}) as Record<string, { enabled: boolean }>,
		)
			.filter(([, cfg]) => cfg.enabled)
			.map(([id]) => id);
		const { missing } = checkRequirements(
			getTemplates(),
			body.services ? posted : getEnabledTemplates(db).map((t) => t.id),
		);
		if (missing.length > 0) {
			return c.json(
				{ error: requirementMessage(missing), unmet: missing },
				400,
			);
		}

		// Refused before anything is written, so a wrong window changes nothing
		const conflict = await ownershipConflict(db);
		if (conflict) return c.json({ error: conflict }, 409);

		if (body.paths) applyPaths(db, body.paths);
		if (body.libraries) applyLibraries(db, body.libraries);
		if (body.credentials) applyCredentials(db, body.credentials);
		if (body.services) applyServices(db, body.services);

		const s = db.all();

		if (!s["paths.config"] || !s["paths.media"] || !s["paths.torrents"]) {
			return c.json({ error: "Missing required paths" }, 400);
		}

		if (db.get("setup.global") === "in_progress") {
			return c.json({ error: "Setup already in progress" }, 409);
		}

		resetStatus(db);
		runSetup(db);

		return c.json({ success: true, message: "Setup started" });
	});

	/**
	 * What the run would look like, without starting it: the same keys and the
	 * same labels the status endpoint will serve once it has, so the summary can
	 * draw the exact grid the next screen animates.
	 */
	app.post("/preview", async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as SetupBody;
		const view = withConfig(db, body);
		const steps: Record<string, StepStatus> = {};
		for (const key of getSteps(view)) steps[key] = "pending";
		return c.json({ steps, labels: getLabels(view) });
	});

	app.get("/status", (c) => {
		const global = (db.get("setup.global") as StepStatus) || "pending";
		const steps = getStatus(db);
		const err = db.get("setup.error") as string | null;

		return c.json({
			global,
			steps,
			labels: getLabels(db),
			error: err,
		});
	});

	return app;
}
