import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { forgetContainerStatuses } from "../lib/container-status.js";
import { loadTemplates } from "../lib/service-registry.js";
import { configuredDb } from "../test/fake-db.js";
import { servicesRoutes } from "./services.js";

// `GET /` reads container states, which is the one case here that would reach a
// daemon. An empty listing is the shape docker gives for a project that was
// never brought up, so every service reads as absent.
vi.mock("../lib/docker-cli.js", () => ({
	runDockerSync: vi.fn(() => ""),
	runComposeSync: vi.fn(() => ""),
}));

afterEach(() => forgetContainerStatuses());

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

/**
 * Computed on every read rather than stored, so it cannot go stale. Beta is the
 * fixtures' mediaManager and declares it needs a mediaServer; Eta is the only
 * one, which makes the pair the satisfied and unsatisfied cases.
 */
describe("GET / reports what a service is missing", () => {
	const find = async (db: ReturnType<typeof configuredDb>, id: string) => {
		const res = await servicesRoutes(db).request("/");
		const services = (await res.json()) as {
			name: string;
			unmet: { category: string; reason?: string }[];
		}[];
		return services.find((s) => s.name === id);
	};

	it("names the unmet category, with the reason the template wrote", async () => {
		const beta = await find(
			configuredDb({ "services.beta.enabled": true }),
			"beta",
		);
		expect(beta?.unmet).toEqual([
			{
				category: "mediaServer",
				reason:
					"Beta reads its library off a media server — install Eta first.",
			},
		]);
	});

	it("reports nothing once a member of the category is installed", async () => {
		const beta = await find(
			configuredDb({
				"services.beta.enabled": true,
				"services.eta.enabled": true,
			}),
			"beta",
		);
		expect(beta?.unmet).toEqual([]);
	});

	// A disabled service has no needs to report: it is not installed, so nothing
	// about it is broken.
	it("says nothing about a service that is not enabled", async () => {
		const beta = await find(configuredDb(), "beta");
		expect(beta?.unmet).toEqual([]);
	});
});
