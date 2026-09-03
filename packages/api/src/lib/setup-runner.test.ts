import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
import { template } from "../test/helpers.js";
import { loadTemplates, runSetupStep } from "./service-registry.js";
import type { ServiceTemplate } from "./service-registry.js";
import {
	runTemplateSteps,
	stepEnabled,
	stepKeys,
	stepPhase,
} from "./setup-runner.js";

const FIXTURES = fileURLToPath(new URL("../test/fixtures", import.meta.url));

beforeAll(() => loadTemplates(FIXTURES));

describe("stepPhase", () => {
	it("puts config files before the containers start", () => {
		expect(stepPhase({ name: "c", label: "c", type: "config_file" })).toBe(
			"pre_up",
		);
	});

	it("puts everything that talks to a service after", () => {
		for (const type of [
			"wait_ready",
			"api_call",
			"extract_from_logs",
		] as const) {
			expect(stepPhase({ name: "s", label: "s", type })).toBe("post_up");
		}
	});
});

describe("stepKeys", () => {
	it("expands a foreach step once per library, in template order", () => {
		expect(stepKeys(configuredDb(), template("alpha"))).toEqual([
			"alpha.config",
			"alpha.wait_ready",
			"alpha.add_library_Movies",
			"alpha.add_library_TvShows",
		]);
	});

	it("reads the scalar shorthand and the long form the same way", () => {
		const alpha = template("alpha");
		const step = { name: "s", label: "s", type: "api_call" as const };
		const short = { ...alpha, setup: [{ ...step, foreach: "libraries" }] };
		const long = {
			...alpha,
			setup: [{ ...step, foreach: { source: "libraries" } }],
		};
		const db = configuredDb();
		expect(stepKeys(db, short)).toEqual(stepKeys(db, long));
		expect(stepKeys(db, short)).toHaveLength(2);
	});

	it("runs once for a source nothing iterates", () => {
		const alpha = template("alpha");
		const tpl: ServiceTemplate = {
			...alpha,
			setup: [
				{
					name: "s",
					label: "s",
					type: "api_call",
					foreach: { source: "countries", type: "tvshows" },
				},
			],
		};
		expect(stepKeys(configuredDb(), tpl)).toEqual(["alpha.s"]);
	});

	it("keeps only the libraries of the type a step declares", () => {
		const alpha = template("alpha");
		const tvOnly: ServiceTemplate = {
			...alpha,
			setup: [
				{
					name: "root_folder",
					label: "Add root folder",
					type: "api_call",
					foreach: { source: "libraries", type: "tvshows" },
				},
			],
		};
		expect(stepKeys(configuredDb(), tvOnly)).toEqual([
			"alpha.root_folder_TvShows",
		]);
	});

	it("follows the libraries the user actually defined", () => {
		const db = configuredDb({
			libraries: JSON.stringify([{ name: "Anime", type: "tvshows" }]),
		});
		expect(stepKeys(db, template("alpha"))).toContain(
			"alpha.add_library_Anime",
		);
	});
});

describe("stepEnabled", () => {
	const guarded = (condition: string | string[]) => ({
		name: "register",
		label: "Register",
		type: "api_call" as const,
		if: condition,
	});

	it("runs an unguarded step", () => {
		expect(
			stepEnabled(configuredDb(), template("alpha"), {
				name: "s",
				label: "s",
				type: "api_call",
			}),
		).toBe(true);
	});

	it("follows whether the peer is enabled", () => {
		const cond = "{{services.beta.enabled}}";
		const on = configuredDb({ "services.beta.enabled": true });
		const off = configuredDb({ "services.beta.enabled": false });
		expect(stepEnabled(on, template("alpha"), guarded(cond))).toBe(true);
		expect(stepEnabled(off, template("alpha"), guarded(cond))).toBe(false);
	});

	it("requires every condition of a list to hold", () => {
		const both = ["{{services.beta.enabled}}", "{{services.zeta.enabled}}"];
		const one = configuredDb({
			"services.beta.enabled": true,
			"services.zeta.enabled": false,
		});
		const all = configuredDb({
			"services.beta.enabled": true,
			"services.zeta.enabled": true,
		});
		expect(stepEnabled(one, template("alpha"), guarded(both))).toBe(false);
		expect(stepEnabled(all, template("alpha"), guarded(both))).toBe(true);
	});

	it("treats a peer that does not exist as absent, not as an error", () => {
		const db = configuredDb();
		expect(
			stepEnabled(db, template("alpha"), guarded("{{services.ghost.enabled}}")),
		).toBe(false);
	});

	it("keeps a step that will not run out of the status list", () => {
		const alpha = template("alpha");
		const tpl: ServiceTemplate = {
			...alpha,
			setup: [
				{ name: "always", label: "Always", type: "api_call" },
				{
					name: "never",
					label: "Never",
					type: "api_call",
					if: "{{services.beta.enabled}}",
				},
			],
		};
		expect(stepKeys(configuredDb(), tpl)).toEqual(["alpha.always"]);
	});
});

describe("merge", () => {
	/**
	 * A tiny stand-in for an API that refuses anything but the whole object —
	 * which is the only reason `merge` exists.
	 */
	function server(state: Record<string, unknown>) {
		const seen: Record<string, unknown>[] = [];
		const fetchMock = async (_url: string, init?: RequestInit) => {
			if (!init?.method || init.method === "GET") {
				return new Response(JSON.stringify(state), { status: 200 });
			}
			const body = JSON.parse(String(init.body)) as Record<string, unknown>;
			seen.push(body);
			return new Response("{}", { status: 200 });
		};
		return { seen, fetchMock };
	}

	it("lays the step's keys over the resource and sends it whole", async () => {
		const { seen, fetchMock } = server({
			id: 1,
			name: "Any",
			items: [{ quality: "WEB 1080p" }],
			language: { id: -2, name: "Original" },
		});
		vi.stubGlobal("fetch", fetchMock);

		await runSetupStep(
			{
				name: "lang",
				label: "Language",
				type: "api_call",
				method: "PUT",
				merge: true,
				url: "http://localhost:7878/api/v3/qualityprofile/1",
				body: { language: { id: -1, name: "Any" } },
			},
			configuredDb(),
			"radarr",
		);

		expect(seen).toHaveLength(1);
		// the field we asked for…
		expect(seen[0].language).toEqual({ id: -1, name: "Any" });
		// …and everything we had no business knowing about
		expect(seen[0].items).toEqual([{ quality: "WEB 1080p" }]);
		expect(seen[0].name).toBe("Any");
		vi.unstubAllGlobals();
	});

	it("sends the body alone when merge is off", async () => {
		const { seen, fetchMock } = server({ id: 1, name: "Any" });
		vi.stubGlobal("fetch", fetchMock);

		await runSetupStep(
			{
				name: "plain",
				label: "Plain",
				type: "api_call",
				method: "PUT",
				url: "http://localhost:7878/api/v3/qualityprofile/1",
				body: { language: { id: -1 } },
			},
			configuredDb(),
			"radarr",
		);

		expect(seen[0]).toEqual({ language: { id: -1 } });
		vi.unstubAllGlobals();
	});
});

describe("runTemplateSteps", () => {
	let dir: string;
	let db: Db;
	/** Alpha's config_file step alone — the rest of its pipeline needs a network. */
	let preUpOnly: ServiceTemplate;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "stupeflix-test-"));
		db = configuredDb({
			"paths.config": dir,
			"credentials.alpha.user": "hugo",
		});
		const alpha = template("alpha");
		preUpOnly = {
			...alpha,
			setup: alpha.setup.filter((s) => s.type === "config_file"),
		};
	});

	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("runs the steps of the requested phase and records them", async () => {
		await runTemplateSteps(db, preUpOnly, "pre_up");
		expect(readFileSync(join(dir, "alpha/alpha.conf"), "utf-8")).toBe(
			"user=hugo\n",
		);
		expect(db.get("setup.status.alpha.config")).toBe("completed");
	});

	it("skips the steps of the other phase", async () => {
		await runTemplateSteps(db, preUpOnly, "post_up");
		expect(db.get("setup.status.alpha.config")).toBeNull();
	});

	it("injects the per-type values of `map` into each run", async () => {
		const mapped: ServiceTemplate = {
			...preUpOnly,
			setup: [
				{
					name: "write",
					label: "Write",
					type: "config_file",
					foreach: {
						source: "libraries",
						map: {
							movies: { kind: "movie" },
							tvshows: { kind: "show" },
						},
					},
					file: "{{library.name}}.conf",
					content: "kind={{library.kind}}\n",
				},
			],
		};

		await runTemplateSteps(db, mapped, "pre_up");
		expect(readFileSync(join(dir, "Movies.conf"), "utf-8")).toBe(
			"kind=movie\n",
		);
		expect(readFileSync(join(dir, "TvShows.conf"), "utf-8")).toBe(
			"kind=show\n",
		);
	});

	it("does not run a step whose condition is false", async () => {
		const guarded: ServiceTemplate = {
			...preUpOnly,
			setup: [
				{
					name: "optional",
					label: "Optional",
					type: "config_file",
					if: "{{services.beta.enabled}}",
					file: "skipped.conf",
					content: "x",
				},
			],
		};

		await runTemplateSteps(db, guarded, "pre_up");
		expect(existsSync(join(dir, "skipped.conf"))).toBe(false);
		expect(db.get("setup.status.alpha.optional")).toBeNull();
	});

	it("marks the failing step and stops, so the UI can point at it", async () => {
		const broken: ServiceTemplate = {
			...preUpOnly,
			setup: [
				{
					name: "first",
					label: "First",
					type: "config_file",
					file: "a.conf",
					content: "x",
				},
				{ name: "broken", label: "Broken", type: "config_file" },
				{
					name: "never",
					label: "Never",
					type: "config_file",
					file: "b.conf",
					content: "x",
				},
			],
		};

		await expect(runTemplateSteps(db, broken, "pre_up")).rejects.toThrow(
			/Broken/,
		);
		expect(db.get("setup.status.alpha.first")).toBe("completed");
		expect(db.get("setup.status.alpha.broken")).toBe("failed");
		expect(db.get("setup.status.alpha.never")).toBeNull();
	});
});
