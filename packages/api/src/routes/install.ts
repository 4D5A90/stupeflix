import { exec } from "node:child_process";
import { writeFileSync } from "node:fs";
import { promisify } from "node:util";
import { Hono } from "hono";
import type { Db } from "../db.js";
import { generateCompose } from "../lib/compose.js";
import { configureJoal } from "../lib/configs.js";
import { getTemplates, runSetupStep } from "../lib/service-registry.js";
import type { ServiceTemplate } from "../lib/service-registry.js";
import { error as logError, log } from "../lib/logger.js";

const execAsync = promisify(exec);

function getLibraries(db: Db): Array<{ name: string; type: string }> {
	const raw = db.get("libraries") as string;
	if (!raw) return [{ name: "Movies", type: "movies" }, { name: "TvShows", type: "tvshows" }];
	return JSON.parse(raw);
}

type StepStatus = "pending" | "in_progress" | "completed" | "failed";

function setStepStatus(db: Db, key: string, status: StepStatus) {
	db.set(`setup.status.${key}`, status);
}

async function runServiceInstall(db: Db, tpl: ServiceTemplate): Promise<void> {
	try {
		db.set("setup.global", "in_progress");

		writeFileSync("./docker-compose.yml", generateCompose(db));
		if (tpl.id === "joal") configureJoal(db.get("paths.config") as string);
		await execAsync(`docker compose up -d ${tpl.container}`);

		const libraries = getLibraries(db);
		for (const step of tpl.setup) {
			if (step.foreach === "libraries") {
				for (const lib of libraries) {
					const stepKey = `${tpl.id}.${step.name}_${lib.name}`;
					setStepStatus(db, stepKey, "in_progress");
					const libVars: Record<string, string> = {
						"library.name": lib.name,
						"library.type": lib.type,
					};
					const mapped = step.typeMap?.[lib.type];
					if (mapped) {
						for (const [k, v] of Object.entries(mapped)) {
							libVars[`library.${k}`] = v;
						}
					}
					const err = await runSetupStep(step, db, tpl.id, libVars);
					if (err) throw new Error(`${step.label} (${lib.name}): ${err}`);
					setStepStatus(db, stepKey, "completed");
				}
			} else {
				const stepKey = `${tpl.id}.${step.name}`;
				setStepStatus(db, stepKey, "in_progress");
				const err = await runSetupStep(step, db, tpl.id);
				if (err) throw new Error(`${step.label}: ${err}`);
				setStepStatus(db, stepKey, "completed");
			}

			log(`[install:${tpl.id}] ${step.label} completed`);
		}

		db.set("setup.global", "completed");
		db.set("setup.error", null);
		log(`[install] ${tpl.id} installed`);
	} catch (e) {
		logError(`[install:${tpl.id}] failed`, e);
		db.set(`services.${tpl.id}.enabled`, false);
		db.set("setup.global", "failed");
		db.set("setup.error", e instanceof Error ? e.message : String(e));
		try { await execAsync(`docker compose stop ${tpl.container}`); } catch {}
	}
}

export function installRoutes(db: Db) {
	const app = new Hono();

	app.post("/:name", async (c) => {
		const name = c.req.param("name");
		const tpl = getTemplates().find((t) => t.id === name);
		if (!tpl) return c.json({ error: "Template not found" }, 404);
		if (db.get("setup.global") === "in_progress") return c.json({ error: "Setup already in progress" }, 409);
		// Block only if genuinely installed (not a leftover from a failed install)
		if (db.get(`services.${name}.enabled`) && db.get("setup.global") !== "failed") {
			return c.json({ error: "Already installed" }, 409);
		}

		const body = await c.req.json().catch(() => ({}));
		const credentials: Record<string, string> = body.credentials ?? {};

		for (const [key, value] of Object.entries(credentials)) {
			db.set(`credentials.${name}.${key}`, value);
		}
		db.set(`services.${name}.enabled`, true);
		db.set("setup.error", null);

		// Initialize this service's steps as pending (keeps existing services' statuses intact)
		const libraries = getLibraries(db);
		for (const step of tpl.setup) {
			if (step.foreach === "libraries") {
				for (const lib of libraries) {
					setStepStatus(db, `${name}.${step.name}_${lib.name}`, "pending");
				}
			} else {
				setStepStatus(db, `${name}.${step.name}`, "pending");
			}
		}

		runServiceInstall(db, tpl);
		return c.json({ success: true });
	});

	return app;
}
