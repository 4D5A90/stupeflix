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
	ensureSecrets,
	getEnabledTemplates,
	getGeneratedConfigFiles,
	getResetDirs,
	getServiceMetas,
	getTemplateDefaults,
	loadTemplates,
	runSetupStep,
} from "./service-registry.js";
import type { SetupStepDef } from "./service-registry.js";

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
		expect(await runSetupStep(custom, db, "alpha")).toBeNull();
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
		url: "http://service.test/identity",
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
		url: "http://service.test/library/sections",
		method: "POST",
		headers: { "X-Token": "{{credentials.alpha.user}}" },
		skipIf: {
			url: "http://service.test/library/sections",
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

		await expect(runSetupStep(step, db, "alpha")).resolves.toBeNull();
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
