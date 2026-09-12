import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type { Db } from "../db.js";
import { configuredDb } from "../test/fake-db.js";
import { stepOfType, template } from "../test/helpers.js";
import {
	SKIPPED,
	ensureSecrets,
	getEnabledTemplates,
	getGeneratedConfigFiles,
	getResetDirs,
	getServiceMetas,
	getTemplateDefaults,
	loadTemplates,
	runSetupStep,
	sortByDependencies,
} from "./service-registry.js";
import type { ServiceTemplate, SetupStepDef } from "./service-registry.js";

const FIXTURES = fileURLToPath(new URL("../test/fixtures", import.meta.url));

beforeAll(() => loadTemplates(FIXTURES));

describe("loadTemplates", () => {
	it("reads the new schema off disk", () => {
		const alpha = template("alpha");
		expect(alpha.compose).toHaveProperty("alpha");
		expect(alpha.dirs).toEqual(["alpha/cache"]);
		expect(alpha.reset?.dirs).toEqual(["alpha"]);
		expect(Object.keys(alpha.actions ?? {})).toEqual(["scan"]);
	});
});

describe("getServiceMetas", () => {
	it("always ships notes as an array, so the UI needs no guard", () => {
		const beta = getServiceMetas().find((m) => m.id === "beta");
		expect(beta?.notes).toEqual([]);
	});

	it("always ships credentials as an array, for a service that asks nothing", () => {
		const eta = getServiceMetas().find((m) => m.id === "eta");
		expect(eta?.credentials).toEqual([]);
	});

	it("passes a template's notes through", () => {
		const alpha = getServiceMetas().find((m) => m.id === "alpha");
		expect(alpha?.notes).toEqual(["Needs a manual step in its own UI."]);
	});
});

describe("getTemplateDefaults", () => {
	it("derives the enable flag from the template", () => {
		const defaults = getTemplateDefaults();
		expect(defaults["services.alpha.enabled"]).toBe(true);
		expect(defaults["services.beta.enabled"]).toBe(false);
	});

	it("derives credential defaults, blank when the template gives none", () => {
		const defaults = getTemplateDefaults();
		expect(defaults["credentials.alpha.user"]).toBe("admin");
		expect(defaults["credentials.beta.optional"]).toBe("");
	});
});

describe("getEnabledTemplates", () => {
	it("returns only what the wizard turned on", () => {
		const db = configuredDb({
			"services.alpha.enabled": true,
			"services.beta.enabled": false,
		});
		expect(getEnabledTemplates(db).map((t) => t.id)).toEqual(["alpha"]);
	});
});

describe("ensureSecrets", () => {
	let db: Db;
	beforeEach(() => {
		db = configuredDb();
	});

	it("mints a hex secret of the declared byte length", () => {
		ensureSecrets(db, template("alpha"));
		expect(db.get("internal.alpha.api_key")).toMatch(/^[0-9a-f]{16}$/);
	});

	it("mints a uuid when asked for one", () => {
		ensureSecrets(db, template("zeta"));
		expect(db.get("internal.zeta.token")).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});

	it("never rotates an existing secret", () => {
		ensureSecrets(db, template("alpha"));
		const first = db.get("internal.alpha.api_key");
		ensureSecrets(db, template("alpha"));
		expect(db.get("internal.alpha.api_key")).toBe(first);
	});

	it("is a no-op for a template that declares none", () => {
		ensureSecrets(db, template("beta"));
		expect(
			Object.keys(db.all()).filter((k) => k.startsWith("internal.")),
		).toEqual([]);
	});
});

describe("reconfigure surface", () => {
	it("lists the files the templates declare writing", () => {
		expect(getGeneratedConfigFiles(configuredDb())).toEqual([
			"alpha/alpha.conf",
		]);
	});

	it("covers disabled services too, so no stale config survives", () => {
		const enabledOnly = configuredDb({ "services.alpha.enabled": false });
		expect(getGeneratedConfigFiles(enabledOnly)).toContain("alpha/alpha.conf");
	});

	it("lists only the directories a template asks to reset", () => {
		// alpha/cache is a `dirs` entry, not a reset target — it must not appear
		expect(getResetDirs()).toEqual(["alpha"]);
	});
});

describe("runSetupStep: config_file", () => {
	let dir: string;
	let db: Db;
	let step: SetupStepDef;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "stupeflix-test-"));
		db = configuredDb({
			"paths.config": dir,
			"credentials.alpha.user": "hugo",
		});
		step = stepOfType(template("alpha"), "config_file");
	});

	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("writes the file, creating parent directories", async () => {
		expect(await runSetupStep(step, db, "alpha")).toBeNull();
		expect(readFileSync(join(dir, "alpha/alpha.conf"), "utf-8")).toBe(
			"user=hugo\n",
		);
	});

	it("leaves an existing file alone by default", async () => {
		writeFileSync(join(dir, "existing.conf"), "hand written");
		const custom = { ...step, file: "existing.conf", content: "generated" };
		// Not null: nothing was written, and a caller must be able to tell that
		// apart from a file this step produced.
		expect(await runSetupStep(custom, db, "alpha")).toBe(SKIPPED);
		expect(readFileSync(join(dir, "existing.conf"), "utf-8")).toBe(
			"hand written",
		);
	});

	it("overwrites when the template opts out of skipIfExists", async () => {
		writeFileSync(join(dir, "existing.conf"), "hand written");
		const custom = {
			...step,
			file: "existing.conf",
			content: "generated",
			skipIfExists: false,
		};
		expect(await runSetupStep(custom, db, "alpha")).toBeNull();
		expect(readFileSync(join(dir, "existing.conf"), "utf-8")).toBe("generated");
	});

	it("reports a template that forgot its file instead of writing nowhere", async () => {
		const broken = { ...step, file: undefined };
		expect(await runSetupStep(broken, db, "alpha")).toMatch(/requires file/);
		expect(existsSync(join(dir, "alpha"))).toBe(false);
	});
});

describe("runSetupStep: wait_ready", () => {
	const step: SetupStepDef = {
		name: "wait_ready",
		label: "Wait",
		type: "wait_ready",
		url: "http://localhost:1111/identity",
	};
	let db: Db;

	beforeEach(() => {
		db = configuredDb();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("accepts any response when the template asks for no match", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("nope", { status: 403 })),
		);
		await expect(runSetupStep(step, db, "alpha")).resolves.toBeNull();
	});

	/**
	 * The Plex case: /identity answers within a second of boot but reports
	 * claimed="0" until the server has registered with plex.tv, and every
	 * privileged call in that window comes back 403.
	 */
	it("keeps polling until the body matches, not merely until it answers", async () => {
		const bodies = [
			'<MediaContainer claimed="0"/>',
			'<MediaContainer claimed="1"/>',
		];
		const fetchMock = vi.fn(async () => new Response(bodies.shift() ?? ""));
		vi.stubGlobal("fetch", fetchMock);

		const running = runSetupStep(
			{ ...step, match: 'claimed="1"' },
			db,
			"alpha",
		);
		await vi.advanceTimersByTimeAsync(2000);

		await expect(running).resolves.toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("names the pattern when a service answers but never reaches the state", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response('<MediaContainer claimed="0"/>')),
		);

		const running = runSetupStep(
			{ ...step, match: 'claimed="1"' },
			db,
			"alpha",
		);
		await vi.advanceTimersByTimeAsync(120000);

		await expect(running).resolves.toMatch(/to match \/claimed="1"\//);
	});
});

describe("runSetupStep: skipIf", () => {
	type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
	const step: SetupStepDef = {
		name: "add_library",
		label: "Add library",
		type: "api_call",
		url: "http://localhost:1111/library/sections",
		method: "POST",
		headers: { "X-Token": "{{credentials.alpha.user}}" },
		skipIf: {
			url: "http://localhost:1111/library/sections",
			match: 'title="Movies"',
		},
	};
	let db: Db;

	beforeEach(() => {
		db = configuredDb({ "credentials.alpha.user": "hugo" });
	});

	afterEach(() => vi.unstubAllGlobals());

	/**
	 * Plex answers a duplicate library name with 201 and a second section, so
	 * nothing but a probe can keep a re-run of the install idempotent.
	 */
	it("probes instead of calling when the work is already done", async () => {
		const fetchMock = vi.fn<Fetch>(
			async () => new Response('<Directory title="Movies"/>'),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(runSetupStep(step, db, "alpha")).resolves.toBe(SKIPPED);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		// The probe is a GET; a POST here would mean a second library was created
		expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
		expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({
			"X-Token": "hugo",
		});
	});

	it("falls through to the call when the probe finds no match", async () => {
		const fetchMock = vi.fn<Fetch>(
			async () => new Response("<MediaContainer/>"),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(runSetupStep(step, db, "alpha")).resolves.toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
		expect(fetchMock.mock.calls[1][1]?.method).toBe("POST");
	});

	it("falls through when the probe itself fails, rather than silently skipping", async () => {
		const fetchMock = vi
			.fn<Fetch>()
			.mockRejectedValueOnce(new Error("connection refused"))
			.mockResolvedValue(new Response("", { status: 201 }));
		vi.stubGlobal("fetch", fetchMock);

		await expect(runSetupStep(step, db, "alpha")).resolves.toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0][1]?.method).toBeUndefined();
		expect(fetchMock.mock.calls[1][1]?.method).toBe("POST");
	});
});

/**
 * One vocabulary for what used to be four. `body` and `cookie` read the answer
 * of the `api_call` they sit on; `logs` and `file` have no answer to read, so
 * they are a step of their own.
 */
describe("runSetupStep: store", () => {
	type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
	let db: Db;

	beforeEach(() => {
		db = configuredDb();
	});
	afterEach(() => vi.unstubAllGlobals());

	const call = (store: SetupStepDef["store"]): SetupStepDef => ({
		name: "login",
		label: "Login",
		type: "api_call",
		url: "http://localhost:1111/login",
		method: "POST",
		store,
	});

	it("walks a dot path into the JSON response", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn<Fetch>()
				.mockResolvedValue(
					Response.json({ Items: [{ AccessToken: "abc123" }] }),
				),
		);
		const step = call({
			from: "body",
			path: "Items.0.AccessToken",
			as: "api_key",
		});
		await expect(runSetupStep(step, db, "alpha")).resolves.toBeNull();
		expect(db.get("internal.alpha.api_key")).toBe("abc123");
	});

	/**
	 * A 4xx body is not the document the path was written against. Storing
	 * whatever sits at that key would poison the slot for every later step, which
	 * would then fail somewhere else entirely.
	 */
	it("keeps nothing from a failed response", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn<Fetch>()
				.mockResolvedValue(Response.json({ token: "nope" }, { status: 401 })),
		);
		const step = call({ from: "body", path: "token", as: "token" });
		await expect(runSetupStep(step, db, "alpha")).resolves.toEqual(
			expect.stringContaining("401"),
		);
		expect(db.get("internal.alpha.token")).toBeNull();
	});

	it("takes the session cookie off the headers", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn<Fetch>()
				.mockResolvedValue(
					new Response("", { headers: { "set-cookie": "SID=xyz; Path=/" } }),
				),
		);
		const step = call({ from: "cookie", as: "cookie" });
		await expect(runSetupStep(step, db, "alpha")).resolves.toBeNull();
		expect(db.get("internal.alpha.cookie")).toBe("SID=xyz; Path=/");
	});

	it("reads capture group 1 out of a file under paths.config", async () => {
		const dir = mkdtempSync(join(tmpdir(), "stupeflix-store-"));
		try {
			db = configuredDb({ "paths.config": dir });
			writeFileSync(join(dir, "prefs.xml"), '<P PlexOnlineToken="tok-42"/>');
			const step: SetupStepDef = {
				name: "extract_token",
				label: "Extract token",
				type: "store",
				store: {
					from: "file",
					file: "prefs.xml",
					regex: 'PlexOnlineToken="([^"]+)"',
					as: "token",
				},
			};
			await expect(runSetupStep(step, db, "alpha")).resolves.toBeNull();
			expect(db.get("internal.alpha.token")).toBe("tok-42");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("refuses to climb out of paths.config", async () => {
		const step: SetupStepDef = {
			name: "escape",
			label: "Escape",
			type: "store",
			store: {
				from: "file",
				file: "../../etc/passwd",
				regex: "root:(.*)",
				as: "leak",
			},
		};
		await expect(runSetupStep(step, db, "alpha")).resolves.toEqual(
			expect.stringContaining("outside paths.config"),
		);
	});

	// `body` and `cookie` name a response, and a step of its own has none. Saying
	// so beats storing nothing and reporting success.
	it("refuses a response source on a step with no response", async () => {
		const step: SetupStepDef = {
			name: "nope",
			label: "Nope",
			type: "store",
			store: { from: "body", path: "x", as: "x" },
		};
		await expect(runSetupStep(step, db, "alpha")).resolves.toEqual(
			expect.stringContaining("not a step of its own"),
		);
	});
});

/**
 * The header's shape belongs to the template. It used to be a boolean, and the
 * engine wrote `MediaBrowser Token="…"` — a Jellyfin string living under `src/`,
 * which is what "no file under `src/` names a service" forbids, and which left a
 * service speaking `Bearer` unable to use the mechanism at all.
 */
describe("runSetupStep: useToken", () => {
	type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
	let fetchMock: ReturnType<typeof vi.fn<Fetch>>;

	beforeEach(() => {
		// 204 carries no body, so `null` rather than `""` — the Response
		// constructor refuses a body on that status.
		fetchMock = vi
			.fn<Fetch>()
			.mockResolvedValue(new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	const headers = () =>
		(fetchMock.mock.calls[0][1]?.headers ?? {}) as Record<string, string>;

	it("sends the token in the shape the template wrote", async () => {
		const db = configuredDb({ "internal.alpha.token": "tok-1" });
		const step: SetupStepDef = {
			name: "keys",
			label: "Keys",
			type: "api_call",
			url: "http://localhost:1111/Auth/Keys",
			useToken: 'MediaBrowser Token="{{internal.token}}"',
		};
		await runSetupStep(step, db, "alpha");
		expect(headers().Authorization).toBe('MediaBrowser Token="tok-1"');
	});

	it("takes any other shape just as well", async () => {
		const db = configuredDb({ "internal.alpha.token": "tok-2" });
		const step: SetupStepDef = {
			name: "keys",
			label: "Keys",
			type: "api_call",
			url: "http://localhost:1111/whatever",
			useToken: "Bearer {{internal.token}}",
		};
		await runSetupStep(step, db, "alpha");
		expect(headers().Authorization).toBe("Bearer tok-2");
	});

	// Handing one service's session to another is what the host check is for.
	it("withholds the session from a peer", async () => {
		const db = configuredDb({ "internal.alpha.token": "tok-3" });
		const step: SetupStepDef = {
			name: "peer",
			label: "Peer",
			type: "api_call",
			url: "http://beta:2222/api",
			useToken: "Bearer {{internal.token}}",
		};
		await runSetupStep(step, db, "alpha");
		expect(headers().Authorization).toBeUndefined();
	});

	// An absent token would resolve to `Token=""`, which a service answers 401 to
	// without saying why.
	it("sends no header at all when nothing was stored", async () => {
		const step: SetupStepDef = {
			name: "keys",
			label: "Keys",
			type: "api_call",
			url: "http://localhost:1111/Auth/Keys",
			useToken: "Bearer {{internal.token}}",
		};
		await runSetupStep(step, configuredDb(), "alpha");
		expect(headers().Authorization).toBeUndefined();
	});
});

/**
 * Without it the install order is `readdirSync`'s — the alphabetical order of
 * the file names, which no template declares and every template depended on.
 */
describe("sortByDependencies", () => {
	// Spread from a real fixture rather than cast from a literal: a literal whose
	// optional is explicitly `undefined` overlaps nothing, and the rest stays a
	// template the loader actually validated.
	const tpl = (
		id: string,
		category: string,
		after?: { category: string }[],
	): ServiceTemplate => ({
		...template("alpha"),
		id,
		name: id,
		category,
		container: id,
		setup: [],
		after,
	});

	it("leaves a list that declares nothing exactly as it was", () => {
		const list = [tpl("a", "indexer"), tpl("b", "mediaServer")];
		expect(sortByDependencies(list).map((t) => t.id)).toEqual(["a", "b"]);
	});

	it("moves a template after the category it waits on", () => {
		const list = [
			tpl("seerr", "requests", [{ category: "mediaManager" }]),
			tpl("sonarr", "mediaManager"),
		];
		expect(sortByDependencies(list).map((t) => t.id)).toEqual([
			"sonarr",
			"seerr",
		]);
	});

	// A category, never a service: adding a second media manager must not need
	// the `after:` line touched.
	it("waits on every member of the category, not the first", () => {
		const list = [
			tpl("seerr", "requests", [{ category: "mediaManager" }]),
			tpl("sonarr", "mediaManager"),
			tpl("radarr", "mediaManager"),
		];
		expect(sortByDependencies(list).map((t) => t.id)).toEqual([
			"sonarr",
			"radarr",
			"seerr",
		]);
	});

	it("is stable: a template with no reason to move does not move", () => {
		const list = [
			tpl("zeta", "seeder"),
			tpl("seerr", "requests", [{ category: "mediaManager" }]),
			tpl("alpha", "vpn"),
			tpl("sonarr", "mediaManager"),
		];
		expect(sortByDependencies(list).map((t) => t.id)).toEqual([
			"zeta",
			"alpha",
			"sonarr",
			"seerr",
		]);
	});

	/**
	 * A cycle cannot be blamed on any single file, so nothing is dropped. Refusing
	 * to boot over a relationship between two templates would be worse than the
	 * ordering bug it protects against.
	 */
	it("keeps the original order when templates wait on each other", () => {
		const list = [
			tpl("a", "indexer", [{ category: "mediaServer" }]),
			tpl("b", "mediaServer", [{ category: "indexer" }]),
		];
		expect(sortByDependencies(list).map((t) => t.id)).toEqual(["a", "b"]);
	});
});
