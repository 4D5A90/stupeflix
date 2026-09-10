import { describe, expect, it } from "vitest";
import { fakeDb } from "../test/fake-db.js";
import { settingsRoutes } from "./settings.js";

/** A database the way an installed stack leaves it: settings next to secrets. */
function db() {
	return fakeDb({
		"paths.config": "/srv/config",
		libraries: "[]",
		"services.alpha.enabled": true,
		"setup.completed": true,
		"credentials.qbittorrent.pass": "hunter2",
		"internal.prowlarr.api_key": "deadbeef",
		"auth.token": "the-token",
		"instance.id": "uuid",
	});
}

describe("GET /settings", () => {
	it("hands out the settings and none of the secrets", async () => {
		const res = await settingsRoutes(db()).request("/");
		expect(await res.json()).toEqual({
			"paths.config": "/srv/config",
			libraries: "[]",
			"services.alpha.enabled": true,
			"setup.completed": true,
		});
	});

	it("answers 404 for a secret, the same as for a key that is not there", async () => {
		const app = settingsRoutes(db());
		for (const key of [
			"internal.prowlarr.api_key",
			"credentials.qbittorrent.pass",
			"auth.token",
			"instance.id",
		]) {
			const res = await app.request(`/${key}`);
			expect(res.status, key).toBe(404);
		}
		expect((await app.request("/nothing.here")).status).toBe(404);
	});
});

describe("writing a setting", () => {
	async function put(key: string, value: unknown) {
		return settingsRoutes(db()).request(`/${key}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ value }),
		});
	}

	it("takes the keys the wizard owns", async () => {
		expect((await put("paths.media", "/srv/media")).status).toBe(200);
		expect((await put("services.alpha.enabled", true)).status).toBe(200);
	});

	it("refuses to forge a secret", async () => {
		for (const key of [
			"internal.prowlarr.api_key",
			"credentials.qbittorrent.pass",
			"auth.token",
			"setup.completed",
			"__proto__",
		]) {
			expect((await put(key, "x")).status, key).toBe(400);
		}
	});

	it("refuses a whole batch when one key is not writable", async () => {
		const store = db();
		const res = await settingsRoutes(store).request("/", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				"paths.media": "/srv/media",
				"auth.token": "mine-now",
			}),
		});
		expect(res.status).toBe(400);
		expect(store.get("paths.media")).toBe(null);
		expect(store.get("auth.token")).toBe("the-token");
	});

	it("refuses to delete one", async () => {
		const store = db();
		const res = await settingsRoutes(store).request("/auth.token", {
			method: "DELETE",
		});
		expect(res.status).toBe(400);
		expect(store.get("auth.token")).toBe("the-token");
	});
});
