import { describe, expect, it } from "vitest";
import { fakeDb } from "../test/fake-db.js";
import { dockerRoutes } from "./docker.js";

/**
 * Only the refusals: everything past the guard shells out to docker, and there
 * is no daemon here. That is also where the finding was — `pull` and `generate`
 * had no guard at all, so a loop on either ran while a setup was mid-flight.
 */
describe("the compose verbs, while a setup is running", () => {
	const db = () => fakeDb({ "setup.global": "in_progress" });

	for (const path of ["/generate", "/up", "/down", "/pull"]) {
		it(`refuses ${path}`, async () => {
			const res = await dockerRoutes(db()).request(path, { method: "POST" });
			expect(res.status).toBe(409);
			expect(await res.json()).toEqual({ error: "Setup already in progress" });
		});
	}
});
