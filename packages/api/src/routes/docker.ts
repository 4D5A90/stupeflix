import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { Hono } from "hono";
import type { Db } from "../db.js";
import { generateCompose } from "../lib/compose.js";

export function dockerRoutes(db: Db) {
	const app = new Hono();

	app.post("/generate", (c) => {
		const compose = generateCompose(db);
		writeFileSync("./docker-compose.yml", compose);
		return c.json({ success: true, path: "./docker-compose.yml" });
	});

	app.post("/up", (c) => {
		execSync("docker compose up -d", { stdio: "inherit" });
		return c.json({ success: true });
	});

	app.post("/down", (c) => {
		execSync("docker compose down", { stdio: "inherit" });
		return c.json({ success: true });
	});

	app.post("/pull", (c) => {
		execSync("docker compose pull", { stdio: "inherit" });
		return c.json({ success: true });
	});

	return app;
}
