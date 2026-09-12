import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadTemplates } from "../lib/service-registry.js";
import { configuredDb } from "../test/fake-db.js";
import { installRoutes } from "./install.js";

const FIXTURES = fileURLToPath(new URL("../test/fixtures", import.meta.url));

beforeAll(() => loadTemplates(FIXTURES));

// Every case here is refused before anything reaches Docker, which is the point
// being tested: the guards, not the install.
vi.mock("../lib/docker-cli.js", () => ({
	runDockerSync: vi.fn(() => ""),
	runComposeSync: vi.fn(() => ""),
	runCompose: vi.fn(async () => ""),
}));

const post = (db: ReturnType<typeof configuredDb>, name: string, body = {}) =>
	installRoutes(db).request(`/${name}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

describe("POST /install/:name guards", () => {
	it("404s on a service no template declares", async () => {
		expect((await post(configuredDb(), "nope")).status).toBe(404);
	});

	it("refuses while another setup is running", async () => {
		const db = configuredDb({ "setup.global": "in_progress" });
		expect((await post(db, "beta")).status).toBe(409);
	});

	it("refuses a service that is already installed", async () => {
		const db = configuredDb({ "services.beta.enabled": true });
		expect((await post(db, "beta")).status).toBe(409);
	});

	/**
	 * Beta declares it needs a mediaServer, and Eta is the fixtures' only one.
	 * The wizard says the same thing, but that copy is the affordance and this
	 * one is the contract.
	 */
	it("refuses a service whose requirement nothing satisfies", async () => {
		const res = await post(configuredDb(), "beta");
		expect(res.status).toBe(409);
		const body = (await res.json()) as { unmet: { category: string }[] };
		expect(body.unmet.map((u) => u.category)).toEqual(["mediaServer"]);
	});
});
