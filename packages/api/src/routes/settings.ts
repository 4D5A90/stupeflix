import { Hono } from "hono";
import type { Db } from "../db.js";

export function settingsRoutes(db: Db) {
	const app = new Hono();

	app.get("/", (c) => c.json(db.all()));

	app.get("/:key", (c) => {
		const key = c.req.param("key");
		const value = db.get(key);
		return value !== null
			? c.json({ key, value })
			: c.json({ error: "Not found" }, 404);
	});

	app.put("/:key", async (c) => {
		const key = c.req.param("key");
		const { value } = await c.req.json();
		db.set(key, value);
		return c.json({ key, value });
	});

	app.put("/", async (c) => {
		const body = await c.req.json();
		let updated = 0;
		for (const [key, value] of Object.entries(body)) {
			db.set(key, value);
			updated++;
		}
		return c.json({ updated });
	});

	app.delete("/:key", (c) => {
		const key = c.req.param("key");
		db.delete(key);
		return c.json({ deleted: true });
	});

	return app;
}
