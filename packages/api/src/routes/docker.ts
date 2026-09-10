import { Hono } from "hono";
import type { Db } from "../db.js";
import { writeCompose } from "../lib/compose.js";
import { runComposeSync } from "../lib/docker-cli.js";
import { ownershipConflict } from "../lib/instance.js";

export function dockerRoutes(db: Db) {
	const app = new Hono();

	/** Why this cannot run now, or null. The same two the other verbs check. */
	async function blocked(): Promise<string | null> {
		if (db.get("setup.global") === "in_progress") {
			return "Setup already in progress";
		}
		return await ownershipConflict(db);
	}

	app.post("/generate", async (c) => {
		const refusal = await blocked();
		if (refusal) return c.json({ error: refusal }, 409);
		const path = writeCompose(db);
		return c.json({ success: true, path });
	});

	app.post("/up", async (c) => {
		const refusal = await blocked();
		if (refusal) return c.json({ error: refusal }, 409);
		runComposeSync(["up", "-d"], { inherit: true });
		return c.json({ success: true });
	});

	app.post("/down", async (c) => {
		const refusal = await blocked();
		if (refusal) return c.json({ error: refusal }, 409);
		runComposeSync(["down"], { inherit: true });
		return c.json({ success: true });
	});

	// Guarded like the rest: pulling every image is minutes of disk and network,
	// and it used to be the one destructive-adjacent verb anyone could loop on.
	app.post("/pull", async (c) => {
		const refusal = await blocked();
		if (refusal) return c.json({ error: refusal }, 409);
		runComposeSync(["pull"], { inherit: true });
		return c.json({ success: true });
	});

	return app;
}
