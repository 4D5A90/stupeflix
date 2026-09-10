import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadTemplates } from "../lib/service-registry.js";
import { configuredDb } from "../test/fake-db.js";
import { servicesRoutes } from "./services.js";

const FIXTURES = fileURLToPath(new URL("../test/fixtures", import.meta.url));

beforeAll(() => loadTemplates(FIXTURES));

/**
 * These stop at the guard on purpose — every case below is refused before a
 * container is named, so nothing here needs a docker daemon. That is also the
 * point being tested: the raw path param used to reach the command line.
 */
function routes() {
	return servicesRoutes(configuredDb());
}

describe("the fixed container verbs", () => {
	for (const verb of ["start", "stop", "restart"]) {
		it(`404s on a service no template declares (${verb})`, async () => {
			const res = await routes().request(`/nope/${verb}`, { method: "POST" });
			expect(res.status).toBe(404);
		});

		it(`refuses a name shaped like a shell command (${verb})`, async () => {
			const evil = encodeURIComponent("alpha; echo pwned");
			const res = await routes().request(`/${evil}/${verb}`, {
				method: "POST",
			});
			expect(res.status).toBe(404);
		});
	}
});

describe("GET /:name/logs", () => {
	it("404s on a service no template declares", async () => {
		expect((await routes().request("/nope/logs")).status).toBe(404);
	});

	it("refuses a line count that is not one", async () => {
		// The value that ran a command through /bin/sh in the audit's live probe
		const res = await routes().request("/alpha/logs?lines=1;echo%20MARKER;%23");
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "Invalid line count" });
	});

	it("refuses a count out of range", async () => {
		for (const lines of ["0", "-5", "99999", "1e3"]) {
			const res = await routes().request(`/alpha/logs?lines=${lines}`);
			expect(res.status, `lines=${lines}`).toBe(400);
		}
	});
});
