import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { fakeDb } from "../test/fake-db.js";
import { TOKEN_KEY, accessToken, tokenGate, tokenProblem } from "./auth.js";

function gated(token: string) {
	const app = new Hono();
	app.use("*", tokenGate(token));
	app.get("/health", (c) => c.json({ status: "ok" }));
	app.get("/settings", (c) => c.json({ secret: "shhh" }));
	return app;
}

describe("accessToken", () => {
	it("mints one and keeps it, so a restart does not sign the browser out", () => {
		const db = fakeDb();
		const first = accessToken(db);
		expect(first).toHaveLength(43); // 32 bytes, base64url
		expect(accessToken(db)).toBe(first);
		expect(db.get(TOKEN_KEY)).toBe(first);
	});

	it("reuses the one already in the database", () => {
		expect(accessToken(fakeDb({ [TOKEN_KEY]: "kept" }))).toBe("kept");
	});
});

describe("tokenGate", () => {
	it("lets the healthcheck through at both mounts", async () => {
		for (const path of ["/health", "/api/health"]) {
			const app = new Hono();
			app.use("*", tokenGate("secret"));
			app.get(path, (c) => c.json({ status: "ok" }));
			expect((await app.request(path)).status).toBe(200);
		}
	});

	it("refuses a request with no token", async () => {
		const res = await gated("secret").request("/settings");
		expect(res.status).toBe(401);
		// The shape the web client reads, not bearerAuth's default text body
		expect(await res.json()).toEqual({ error: "Unauthorized" });
	});

	it("refuses the wrong token", async () => {
		const res = await gated("secret").request("/settings", {
			headers: { Authorization: "Bearer wrong" },
		});
		expect(res.status).toBe(401);
	});

	it("accepts the right one", async () => {
		const res = await gated("secret").request("/settings", {
			headers: { Authorization: "Bearer secret" },
		});
		expect(res.status).toBe(200);
	});

	it("does not let a path merely ending in /health through", async () => {
		const app = new Hono();
		app.use("*", tokenGate("secret"));
		app.get("/services/evil/health", (c) => c.json({ status: "ok" }));
		expect((await app.request("/services/evil/health")).status).toBe(401);
	});
});

describe("tokenProblem", () => {
	/*
	 * `hono/bearer-auth` parses the header with `^Bearer +([A-Za-z0-9._~+/-]+=*)`,
	 * so a token outside that set is refused by the *parser*: the correct token
	 * answers 400 and the operator is locked out by their own configuration.
	 * Caught at boot instead, with a message naming the rule.
	 */
	it("takes what the header parser can actually carry", () => {
		for (const token of [
			"abcdefghijklmnop",
			"aG93IG5vdyBicm93biBjb3c=", // openssl rand -base64
			"nT3-_x.QYb~9+abc/def",
		]) {
			expect(tokenProblem(token), token).toBe(null);
		}
	});

	it("refuses one the parser would reject, naming the rule", () => {
		for (const token of [
			"hunter2!hunter2!",
			"with space here!!",
			"é".repeat(20),
		]) {
			expect(tokenProblem(token), token).toMatch(/may only contain/);
		}
	});

	it("refuses one too short to be a token at all", () => {
		expect(tokenProblem("short")).toMatch(/at least 16/);
	});

	it("accepts what accessToken mints", () => {
		expect(tokenProblem(accessToken(fakeDb()))).toBe(null);
	});
});
