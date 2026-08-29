import { exec } from "node:child_process";
import { promisify } from "node:util";
import { Hono } from "hono";
import type { Db } from "../db.js";
import { writeCompose } from "../lib/compose.js";
import { compose } from "../lib/docker-cli.js";
import { createTemplateDirs } from "../lib/helpers.js";
import { log, error as logError } from "../lib/logger.js";
import type { ServiceTemplate } from "../lib/service-registry.js";
import { getTemplate } from "../lib/service-registry.js";
import {
	runTemplateSteps,
	setStepStatus,
	stepKeys,
} from "../lib/setup-runner.js";

const execAsync = promisify(exec);

async function runServiceInstall(db: Db, tpl: ServiceTemplate): Promise<void> {
	try {
		db.set("setup.global", "in_progress");

		writeCompose(db);
		createTemplateDirs(db, tpl);
		await runTemplateSteps(db, tpl, "pre_up");
		await execAsync(compose(`up -d ${tpl.container}`));
		await runTemplateSteps(db, tpl, "post_up");

		db.set("setup.global", "completed");
		db.set("setup.error", null);
		log(`[install] ${tpl.id} installed`);
	} catch (e) {
		logError(`[install:${tpl.id}] failed`, e);
		db.set(`services.${tpl.id}.enabled`, false);
		db.set("setup.global", "failed");
		db.set("setup.error", e instanceof Error ? e.message : String(e));
		try {
			await execAsync(compose(`stop ${tpl.container}`));
		} catch {}
	}
}

export function installRoutes(db: Db) {
	const app = new Hono();

	app.post("/:name", async (c) => {
		const name = c.req.param("name");
		const tpl = getTemplate(name);
		if (!tpl) return c.json({ error: "Template not found" }, 404);
		if (db.get("setup.global") === "in_progress")
			return c.json({ error: "Setup already in progress" }, 409);
		// Block only if genuinely installed (not a leftover from a failed install)
		if (
			db.get(`services.${name}.enabled`) &&
			db.get("setup.global") !== "failed"
		) {
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
		for (const key of stepKeys(db, tpl)) {
			setStepStatus(db, key, "pending");
		}

		runServiceInstall(db, tpl);
		return c.json({ success: true });
	});

	return app;
}
