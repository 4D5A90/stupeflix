import { Hono } from "hono";
import type { Db } from "../db.js";
import { credentialProblems } from "../lib/credential-rules.js";
import { ownershipConflict } from "../lib/instance.js";
import { requirementMessage, unmetRequirements } from "../lib/requirements.js";
import { runServiceInstall } from "../lib/service-install.js";
import {
	getEnabledTemplates,
	getTemplate,
	getTemplates,
} from "../lib/service-registry.js";
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

		const unmet = unmetRequirements(
			getTemplates(),
			getEnabledTemplates(db).map((t) => t.id),
			tpl,
		);
		if (unmet.length > 0) {
			return c.json({ error: requirementMessage(unmet), unmet }, 409);
		}

		const conflict = await ownershipConflict(db);
		if (conflict) return c.json({ error: conflict }, 409);

		const body = await c.req.json().catch(() => ({}));
		const credentials: Record<string, string> = body.credentials ?? {};

		// Checked against what the template declares, before anything is stored:
		// the wizard checks the same rules as you type, but that copy is the
		// affordance and this one is the contract.
		const problems = credentialProblems(tpl, credentials);
		if (problems.length > 0) {
			return c.json({ error: problems.join("; "), problems }, 400);
		}

		for (const [key, value] of Object.entries(credentials)) {
			db.set(`credentials.${name}.${key}`, value);
		}
		// The enabled flag is `runServiceInstall`'s to set. Writing it here made it
		// read its own write when deciding whether the service existed before, so
		// a failed first install left the service marked installed — visible on
		// the dashboard as exited, and no longer offered under "Add service".
		db.set("setup.error", null);

		// Initialize this service's steps as pending (keeps existing services' statuses intact)
		for (const key of stepKeys(db, tpl)) {
			setStepStatus(db, key, "pending");
		}

		// The caller decides what happens to a config a removal left behind. It
		// defaults to keeping it — the destructive reading of an ambiguous request
		// is never the one to assume.
		runServiceInstall(db, tpl, { reset: body.reset === true });
		return c.json({ success: true });
	});

	return app;
}
