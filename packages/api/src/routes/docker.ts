import { Hono } from "hono";
import type { Db } from "../db.js";
import { writeCompose } from "../lib/compose.js";
import { runComposeSync } from "../lib/docker-cli.js";
import { ownershipConflict } from "../lib/instance.js";

export function dockerRoutes(db: Db) {
	const app = new Hono();

	app.post("/generate", (c) => {
		const path = writeCompose(db);
		return c.json({ success: true, path });
	});

	app.post("/up", async (c) => {
		const conflict = await ownershipConflict(db);
		if (conflict) return c.json({ error: conflict }, 409);
		runComposeSync(["up", "-d"], { inherit: true });
		return c.json({ success: true });
	});

	app.post("/down", async (c) => {
		const conflict = await ownershipConflict(db);
		if (conflict) return c.json({ error: conflict }, 409);
		runComposeSync(["down"], { inherit: true });
		return c.json({ success: true });
	});

	app.post("/pull", (c) => {
		runComposeSync(["pull"], { inherit: true });
		return c.json({ success: true });
	});

	return app;
}
