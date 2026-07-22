import { execSync } from "node:child_process";
import { Hono } from "hono";
import type { Db } from "../db.js";
import { writeCompose } from "../lib/compose.js";
import { compose } from "../lib/docker-cli.js";

export function dockerRoutes(db: Db) {
	const app = new Hono();

	app.post("/generate", (c) => {
		const path = writeCompose(db);
		return c.json({ success: true, path });
	});

	app.post("/up", (c) => {
		execSync(compose("up -d"), { stdio: "inherit" });
		return c.json({ success: true });
	});

	app.post("/down", (c) => {
		execSync(compose("down"), { stdio: "inherit" });
		return c.json({ success: true });
	});

	app.post("/pull", (c) => {
		execSync(compose("pull"), { stdio: "inherit" });
		return c.json({ success: true });
	});

	return app;
}
