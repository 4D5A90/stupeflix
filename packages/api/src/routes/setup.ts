import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { Hono } from "hono";
import type { Db } from "../db.js";
import { writeCompose } from "../lib/compose.js";
import { compose } from "../lib/docker-cli.js";
import { COMPOSE_FILE } from "../lib/env.js";
import {
	cleanConfigs,
	createMediaDirs,
	createTemplateDirs,
} from "../lib/helpers.js";
import { debug, error, log } from "../lib/logger.js";
import { getEnabledTemplates } from "../lib/service-registry.js";
import {
	type StepStatus,
	runTemplateSteps,
	setStepStatus,
	stepKeys,
} from "../lib/setup-runner.js";
import type { Library } from "../lib/template-vars.js";

const execAsync = promisify(exec);

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
				await execAsync(compose("down --timeout 10"));
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
		const { stdout, stderr } = await execAsync(compose("up -d"));
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

	app.get("/status", (c) => {
		const global = (db.get("setup.global") as StepStatus) || "pending";
		const steps = getStatus(db);
		const err = db.get("setup.error") as string | null;

		return c.json({
			global,
			steps,
			error: err,
		});
	});

	return app;
}
