import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadTemplates } from "./lib/service-registry.js";
import { fakeDb } from "./test/fake-db.js";

const FIXTURES = fileURLToPath(new URL("./test/fixtures", import.meta.url));

beforeAll(() => loadTemplates(FIXTURES));

/** A built wizard, reduced to the one file that has to be reachable. */
function builtWeb(): string {
	const dir = mkdtempSync(join(tmpdir(), "sfx-web-"));
	writeFileSync(join(dir, "index.html"), "<!doctype html><title>Stupeflix");
	return dir;
}

const TOKEN = "app-test-token-0123";
const auth = { Authorization: `Bearer ${TOKEN}` };
const db = () => fakeDb({ "auth.token": TOKEN });

/*
 * The mount logic, which has exactly one job and got it wrong once: the token
 * gate is registered with `api.use("*")`, and that matches every path — not
 * only the ones `api` has a route for. Mounted at the root in front of the
 * static handler, it answered 401 for `index.html` and locked the very screen
 * that asks for a token. No unit could see it; this can.
 */
describe("packaged, with the wizard served on the same port", () => {
	const app = () => createApp(db(), builtWeb());

	it("serves the wizard with no token", async () => {
		const res = await app().request("/");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toMatch(/text\/html/);
	});

	it("serves the SPA fallback for a path the API does not own", async () => {
		const res = await app().request("/dashboard/whatever");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toMatch(/text\/html/);
	});

	it("still gates the API under /api", async () => {
		expect((await app().request("/api/settings")).status).toBe(401);
		expect(
			(await app().request("/api/settings", { headers: auth })).status,
		).toBe(200);
	});

	it("leaves the healthcheck open, since Docker polls it", async () => {
		expect((await app().request("/api/health")).status).toBe(200);
	});
});

describe("bare, the way `pnpm dev` and the throwaway recipe run it", () => {
	const app = () => createApp(db(), undefined);

	it("answers at the root, where Vite strips the prefix", async () => {
		expect((await app().request("/settings")).status).toBe(401);
		expect((await app().request("/settings", { headers: auth })).status).toBe(
			200,
		);
	});

	it("answers under /api as well", async () => {
		expect(
			(await app().request("/api/settings", { headers: auth })).status,
		).toBe(200);
	});

	it("leaves the healthcheck open at both spellings", async () => {
		expect((await app().request("/health")).status).toBe(200);
		expect((await app().request("/api/health")).status).toBe(200);
	});
});

describe("the headers every response carries", () => {
	it("sets a CSP and no CORS wildcard", async () => {
		const res = await createApp(db(), undefined).request("/health", {
			headers: { Origin: "https://evil.example" },
		});
		expect(res.headers.get("content-security-policy")).toContain(
			"default-src 'self'",
		);
		expect(res.headers.get("access-control-allow-origin")).toBe(null);
	});
});

/*
 * Declared last on purpose: its `beforeAll` repoints the template registry at a
 * scratch directory, and the registry is a module singleton.
 */
describe("POST /templates/upload", () => {
	let dir: string;

	beforeAll(() => {
		dir = mkdtempSync(join(tmpdir(), "sfx-templates-"));
		writeFileSync(join(dir, "shipped.yml"), yaml("shipped"));
		loadTemplates(dir);
	});

	function yaml(id: string, extra = ""): string {
		return [
			`id: ${id}`,
			`name: ${id}`,
			"description: A service",
			"category: indexer",
			"defaultEnabled: false",
			`container: ${id}`,
			"compose:",
			`  ${id}:`,
			"    image: example/demo",
			extra,
			"setup: []",
			"",
		].join("\n");
	}

	async function upload(filename: string, body: string) {
		const form = new FormData();
		form.append("file", new File([body], filename));
		return createApp(db(), undefined).request("/templates/upload", {
			method: "POST",
			headers: auth,
			body: form,
		});
	}

	it("takes a template that is one", async () => {
		const res = await upload("added.yml", yaml("added"));
		expect(res.status).toBe(200);
		expect(existsSync(join(dir, "added.yml"))).toBe(true);
	});

	it("refuses to replace a template that already exists", async () => {
		// `getTemplate` resolves duplicate ids first-match, so a silent overwrite
		// of `shipped.yml` is how you swap a service's compose block for your own.
		const before = readdirSync(dir).length;
		const res = await upload("shipped.yml", yaml("shipped"));
		expect(res.status).toBe(409);
		expect(readdirSync(dir)).toHaveLength(before);
	});

	it("reduces a traversing filename to its basename", async () => {
		const res = await upload("../../escaped.yml", yaml("escaped"));
		// Written inside the directory under its bare name, never above it
		expect(res.status).toBe(200);
		expect(existsSync(join(dir, "escaped.yml"))).toBe(true);
		expect(existsSync(join(dir, "..", "escaped.yml"))).toBe(false);
	});

	it("refuses a name that is not a template file", async () => {
		for (const name of ["x.txt", ".hidden.yml", "", "x.yml.sh"]) {
			expect((await upload(name, yaml("x"))).status, name).toBe(400);
		}
	});

	it("refuses YAML that does not parse, writing nothing", async () => {
		const before = readdirSync(dir).length;
		const res = await upload("broken.yml", "id: [unclosed");
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toMatch(/YAML/);
		expect(readdirSync(dir)).toHaveLength(before);
	});

	it("refuses a container escape, writing nothing", async () => {
		const before = readdirSync(dir).length;
		const res = await upload(
			"evil.yml",
			yaml("evil", '    privileged: true\n    volumes:\n      - "/:/host"'),
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { problems: string[] };
		expect(body.problems.length).toBeGreaterThan(1);
		expect(readdirSync(dir)).toHaveLength(before);
	});
});
