import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadTemplates } from "../lib/service-registry.js";
import { configuredDb } from "../test/fake-db.js";
import { setupRoutes } from "./setup.js";

const FIXTURES = fileURLToPath(new URL("../test/fixtures", import.meta.url));

beforeAll(() => loadTemplates(FIXTURES));

interface Preview {
	steps: Record<string, string>;
	labels: Record<string, string>;
}

async function preview(db: ReturnType<typeof configuredDb>, body: unknown) {
	const res = await setupRoutes(db).request("/preview", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	return (await res.json()) as Preview;
}

describe("POST /setup/preview", () => {
	it("answers with the steps the posted configuration would run", async () => {
		const db = configuredDb();
		const { steps, labels } = await preview(db, {
			services: { alpha: { enabled: true } },
		});

		expect(Object.keys(steps)).toContain("compose");
		expect(Object.keys(steps).some((k) => k.startsWith("alpha."))).toBe(true);
		expect(Object.values(steps).every((s) => s === "pending")).toBe(true);
		// Labels come from the template, which is the whole point of asking the
		// server rather than counting steps in the browser.
		for (const key of Object.keys(steps)) expect(labels[key]).toBeTruthy();
	});

	/**
	 * The screen that calls this is a summary the user can still back out of, and
	 * the same keys tell the dashboard what is installed. Answering the question
	 * must not answer it by making it true.
	 */
	it("writes nothing at all", async () => {
		const db = configuredDb();
		const before = JSON.stringify(db.all());

		await preview(db, {
			paths: { config: "/elsewhere", media: "/elsewhere", torrents: "/x" },
			libraries: [{ name: "Anime", type: "tvshows" }],
			credentials: { alpha: { user: "someone" } },
			services: { alpha: { enabled: true }, beta: { enabled: true } },
		});

		expect(JSON.stringify(db.all())).toBe(before);
	});

	it("expands a foreach step over the libraries it was given, not the stored ones", async () => {
		const db = configuredDb();
		const { steps } = await preview(db, {
			libraries: [
				{ name: "Films", type: "movies" },
				{ name: "Series", type: "tvshows" },
			],
			services: { alpha: { enabled: true } },
		});

		const keys = Object.keys(steps).filter((k) => k.includes("_"));
		expect(keys.some((k) => k.endsWith("_Films"))).toBe(true);
		expect(keys.some((k) => k.endsWith("_Movies"))).toBe(false);
	});
});

describe("POST /setup/paths", () => {
	async function post(paths: unknown) {
		return setupRoutes(configuredDb()).request("/paths", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(paths),
		});
	}

	it("stores three absolute paths", async () => {
		const res = await post({
			config: "/srv/config",
			media: "/srv/media",
			torrents: "/srv/torrents",
		});
		expect(res.status).toBe(200);
	});

	it("refuses a path a reconfigure would then empty", async () => {
		// `cleanServiceConfig` deletes recursively under paths.config.
		const res = await post({
			config: "/etc/../",
			media: "/srv/media",
			torrents: "/srv/torrents",
		});
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toContain(
			"paths.config",
		);
	});

	it("refuses a relative path and a missing one", async () => {
		expect((await post({ config: "config" })).status).toBe(400);
		expect((await post(null)).status).toBe(400);
	});
});
