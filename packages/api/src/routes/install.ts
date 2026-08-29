import { Hono } from "hono";
import type { Db } from "../db.js";
import { runServiceInstall } from "../lib/service-install.js";
import { getTemplate } from "../lib/service-registry.js";
import { setStepStatus, stepKeys } from "../lib/setup-runner.js";

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
