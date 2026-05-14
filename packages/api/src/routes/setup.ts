import { exec } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { Hono } from "hono";
import type { Db } from "../db.js";
import { generateCompose } from "../lib/compose.js";
import { generateConfigs } from "../lib/configs.js";
import { getTemplates, runSetupStep } from "../lib/service-registry.js";
import { cleanConfigs, downloadFloodUI } from "../lib/helpers.js";
import { debug, error, log } from "../lib/logger.js";

const execAsync = promisify(exec);

type StepStatus = "pending" | "in_progress" | "completed" | "failed";

function setStatus(db: Db, step: string, status: StepStatus) {
	db.set(`setup.status.${step}`, status);
}

function getSteps(db: Db): string[] {
	const steps = ["compose", "containers"];
	for (const tpl of getTemplates()) {
		if (!db.get(`services.${tpl.id}.enabled`)) continue;
		for (const step of tpl.setup) {
			steps.push(`${tpl.id}.${step.name}`);
		}
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
		db.set(`setup.status.${step}`, "pending");
	}
	db.set("setup.global", "pending");
	db.set("setup.error", null);
}

async function runSetup(db: Db) {
	const s = db.all();
	const configPath = s["paths.config"] as string;

	try {
		db.set("setup.global", "in_progress");

		// Reset if re-running
		if (existsSync("./docker-compose.yml")) {
			log("Stopping previous containers...");
			try {
				await execAsync("docker compose down --timeout 10");
				log("Previous containers stopped");
			} catch (e) {
				debug("docker compose down warning", e);
			}
			cleanConfigs(configPath);
		}

		// Generate compose
		setStatus(db, "compose", "in_progress");
		log("Generating docker-compose.yml...");
		writeFileSync("./docker-compose.yml", generateCompose(db));
		if (s["services.transmission.enabled"]) {
			downloadFloodUI();
		}
		generateConfigs(db);
		setStatus(db, "compose", "completed");

		// Start containers
		setStatus(db, "containers", "in_progress");
		log("Starting containers...");
		const { stdout, stderr } = await execAsync("docker compose up -d");
		debug("docker compose up", { stdout, stderr });
		setStatus(db, "containers", "completed");

		// Run per-service setup steps from templates
		for (const tpl of getTemplates()) {
			if (!db.get(`services.${tpl.id}.enabled`)) continue;
			for (const step of tpl.setup) {
				const stepKey = `${tpl.id}.${step.name}`;
				setStatus(db, stepKey, "in_progress");
				log(`Running ${step.label}...`);

				const err = await runSetupStep(step, db, tpl.id);
				if (err) {
					throw new Error(`${step.label}: ${err}`);
				}

				setStatus(db, stepKey, "completed");
				log(`${step.label} completed`);
			}
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
		if (body.credentials) applyCredentials(db, body.credentials);
		if (body.services) applyServices(db, body.services);

		const s = db.all();
		const configPath = s["paths.config"] as string;

		if (!configPath || !s["paths.media"] || !s["paths.torrents"]) {
			return c.json({ error: "Missing required paths" }, 400);
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
