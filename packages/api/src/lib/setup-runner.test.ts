import {
	existsSync,
	mkdirSync,
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
import { template } from "../test/helpers.js";
import { loadTemplates, runSetupStep } from "./service-registry.js";
import type { ServiceTemplate, SetupStepDef } from "./service-registry.js";
import {
	pendingRuns,
	replayPendingSteps,
	runTemplateSteps,
	runUninstallHooks,
	setStepStatus,
	statusKeysNaming,
	stepEnabled,
	stepKeys,
	stepPhase,
	stepRuns,
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
		for (const type of ["wait_ready", "api_call", "store"] as const) {
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

describe("stepRuns", () => {
	it("carries the label the template declares, foreach included", () => {
		const db = configuredDb();
		const runs = stepRuns(db, template("beta"));
		expect(runs.length).toBeGreaterThan(0);
		for (const run of runs) {
			expect(run.label).toBeTruthy();
			expect(run.label).not.toBe(run.key);
		}
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

	// A skip is a success that sent nothing. Reported as `completed`, it lets a
	// screen tick a step green while no request ever left — which is what made
	// stale peers impossible to spot.
	it("records a step that had nothing to do as skipped", async () => {
		mkdirSync(join(dir, "alpha"), { recursive: true });
		writeFileSync(join(dir, "alpha/alpha.conf"), "hand written");

		await runTemplateSteps(db, preUpOnly, "pre_up");

		expect(db.get("setup.status.alpha.config")).toBe("skipped");
		expect(readFileSync(join(dir, "alpha/alpha.conf"), "utf-8")).toBe(
			"hand written",
		);
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

/**
 * A step held back by its `if:` never enters the status list, so the absence of
 * a status *is* the record that it was passed over. That is what lets a later
 * install pick it up with no extra bookkeeping.
 */
describe("pendingRuns", () => {
	const guarded = (steps: SetupStepDef[]): ServiceTemplate =>
		({
			id: "alpha",
			name: "Alpha",
			category: "indexer",
			container: "alpha",
			setup: steps,
		}) as ServiceTemplate;

	const peerStep: SetupStepDef = {
		name: "register",
		label: "Register with the peer",
		type: "api_call",
		if: "{{services.beta.enabled}}",
		url: "http://localhost:2222/apps",
	};

	it("holds nothing back while the condition is false", () => {
		const db = configuredDb({ "services.beta.enabled": false });
		expect(pendingRuns(db, guarded([peerStep]))).toHaveLength(0);
	});

	it("offers the step once the condition holds and nothing has run it", () => {
		const db = configuredDb({ "services.beta.enabled": true });
		const pending = pendingRuns(db, guarded([peerStep]));
		expect(pending.map((p) => p.run.key)).toEqual(["alpha.register"]);
	});

	it("leaves a step that already has an outcome alone", () => {
		const db = configuredDb({ "services.beta.enabled": true });
		setStepStatus(db, "alpha.register", "completed");
		expect(pendingRuns(db, guarded([peerStep]))).toHaveLength(0);
	});

	// Including a failure: replaying it would overwrite a red tick the user is
	// looking at, and a retry is something they ask for.
	it("leaves a failed step alone too", () => {
		const db = configuredDb({ "services.beta.enabled": true });
		setStepStatus(db, "alpha.register", "failed");
		expect(pendingRuns(db, guarded([peerStep]))).toHaveLength(0);
	});

	/**
	 * A container reads its config at boot, so writing one now would change a
	 * file nobody rereads. Recreating the container is a reconfigure, and the
	 * user has to ask for that.
	 */
	it("never offers a config_file step, whose container would not reread it", () => {
		const db = configuredDb({ "services.beta.enabled": true });
		const tpl = guarded([
			{
				name: "conf",
				label: "Write config",
				type: "config_file",
				if: "{{services.beta.enabled}}",
				file: "alpha/alpha.conf",
				content: "x",
			},
		]);
		expect(pendingRuns(db, tpl)).toHaveLength(0);
	});
});

describe("replayPendingSteps", () => {
	const tplWith = (id: string, steps: SetupStepDef[]): ServiceTemplate =>
		({
			id,
			name: id,
			category: "indexer",
			container: id,
			setup: steps,
		}) as ServiceTemplate;

	const failing: SetupStepDef = {
		name: "register",
		label: "Register",
		// No `store:` block, so it reports an error without a network.
		type: "store",
		if: "{{services.beta.enabled}}",
	};

	// The template that just ran its own pipeline must not run it twice.
	it("skips the template that triggered it", async () => {
		const db = configuredDb({ "services.beta.enabled": true });
		await replayPendingSteps(db, [tplWith("alpha", [failing])], "alpha");
		expect(db.get("setup.status.alpha.register")).toBeNull();
	});

	/**
	 * The install that triggered this already succeeded. One peer that will not
	 * wire up is not a reason to report it as failed — and it must not hide the
	 * peers that come after it either.
	 */
	it("records a failure, steps over it, and carries on to the next template", async () => {
		const db = configuredDb({ "services.beta.enabled": true });
		await expect(
			replayPendingSteps(db, [
				tplWith("alpha", [failing]),
				tplWith("gamma", [failing]),
			]),
		).resolves.toBeUndefined();
		expect(db.get("setup.status.alpha.register")).toBe("failed");
		expect(db.get("setup.status.gamma.register")).toBe("failed");
	});
});

/**
 * A step whose failure is not the template's failure — for work a service only
 * needs done once, which has nothing left to do on a service whose config
 * survived a removal.
 */
describe("optional steps", () => {
	const withSteps = (steps: SetupStepDef[]): ServiceTemplate =>
		({
			id: "alpha",
			name: "Alpha",
			category: "indexer",
			container: "alpha",
			setup: steps,
		}) as ServiceTemplate;

	const failing = (name: string, optional?: boolean): SetupStepDef => ({
		name,
		label: name,
		type: "store",
		// No `store:` block at all, so the step reports an error without needing a
		// network or a container.
		optional,
	});

	it("records a failure as skipped and lets the pipeline go on", async () => {
		const db = configuredDb();
		const tpl = withSteps([failing("first", true), failing("second", true)]);
		await expect(runTemplateSteps(db, tpl, "post_up")).resolves.toBeUndefined();
		expect(db.get("setup.status.alpha.first")).toBe("skipped");
		expect(db.get("setup.status.alpha.second")).toBe("skipped");
	});

	// The flag is per step, never per type: Plex failing to yield its token is a
	// genuine failure, and the same `store` step must keep saying so.
	it("still stops on a step that did not ask to be optional", async () => {
		const db = configuredDb();
		const tpl = withSteps([failing("first", true), failing("second")]);
		await expect(runTemplateSteps(db, tpl, "post_up")).rejects.toThrow(
			"second",
		);
		expect(db.get("setup.status.alpha.first")).toBe("skipped");
		expect(db.get("setup.status.alpha.second")).toBe("failed");
	});
});

/**
 * Removing a service takes its database with it, so an entry a peer wrote inside
 * it is gone — but the peer's own note still says the step is done. Dropping the
 * note is what puts the step back within reach of a later replay.
 */
describe("statusKeysNaming", () => {
	const withStep = (id: string, step: SetupStepDef): ServiceTemplate =>
		({
			id,
			name: id,
			category: "indexer",
			container: id,
			setup: [step],
		}) as ServiceTemplate;

	const step = (cond: SetupStepDef["if"]): SetupStepDef => ({
		name: "register",
		label: "Register",
		type: "api_call",
		if: cond,
		url: "http://localhost:2222/apps",
	});

	it("finds the steps a single condition made conditional", () => {
		const db = configuredDb();
		const keys = statusKeysNaming(
			db,
			[withStep("alpha", step("{{services.beta.enabled}}"))],
			"beta",
		);
		expect(keys).toEqual(["alpha.register"]);
	});

	// Wiring two services together needs both present, so the condition is a list
	// and the service can sit anywhere in it.
	it("finds them inside a list of conditions", () => {
		const db = configuredDb();
		const keys = statusKeysNaming(
			db,
			[
				withStep(
					"alpha",
					step(["{{services.eta.enabled}}", "{{services.beta.enabled}}"]),
				),
			],
			"beta",
		);
		expect(keys).toEqual(["alpha.register"]);
	});

	it("leaves a step that never named it alone", () => {
		const db = configuredDb();
		const keys = statusKeysNaming(
			db,
			[withStep("alpha", step("{{services.eta.enabled}}"))],
			"beta",
		);
		expect(keys).toEqual([]);
	});

	// A `foreach` step holds one status per run, and all of them go stale together.
	it("names every run of a repeated step", () => {
		const db = configuredDb();
		const repeated: SetupStepDef = {
			...step("{{services.beta.enabled}}"),
			foreach: "libraries",
		};
		expect(statusKeysNaming(db, [withStep("alpha", repeated)], "beta")).toEqual(
			["alpha.register_Movies", "alpha.register_TvShows"],
		);
	});
});

/**
 * The rule that decides where a cleanup lives: clean up where the entry is, and
 * do it when the thing it points at disappears. Sonarr writes a download client
 * into its own database pointing at qBittorrent, so removing qBittorrent leaves
 * Sonarr holding a dead entry — and only Sonarr's API can drop it.
 */
describe("runUninstallHooks", () => {
	type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

	const hooked = (id: string, when: string): ServiceTemplate => {
		// Annotated rather than cast: inside a nested literal TypeScript widens
		// `type` to `string`, which then overlaps nothing in `SetupStepDef`.
		const steps: SetupStepDef[] = [
			{
				name: "drop",
				label: "Drop the entry",
				type: "api_call",
				method: "DELETE",
				url: `http://localhost:1111/clients/${id}`,
			},
		];
		// Built off a real fixture rather than cast from a literal: only the two
		// fields under test are overridden, and the rest stays a template the
		// loader actually validated.
		return {
			...template("alpha"),
			id,
			container: id,
			uninstall: [{ when, steps }],
		};
	};

	afterEach(() => vi.unstubAllGlobals());

	const stub = () => {
		const fetchMock = vi
			.fn<Fetch>()
			.mockResolvedValue(new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
	};

	it("runs the hooks that name the service going away", async () => {
		const fetchMock = stub();
		await runUninstallHooks(
			configuredDb(),
			[hooked("alpha", "beta"), hooked("gamma", "eta")],
			"beta",
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toContain("/clients/alpha");
	});

	// Removing the service itself needs nothing: the entry goes with the database
	// that held it.
	it("never runs the departing service's own hooks", async () => {
		const fetchMock = stub();
		await runUninstallHooks(configuredDb(), [hooked("beta", "beta")], "beta");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	/**
	 * A removal the user asked for must not be held hostage by a peer that will
	 * not answer. The dead entry left behind is the state we were already in.
	 */
	it("steps over a hook that fails, and keeps going", async () => {
		const fetchMock = vi
			.fn<Fetch>()
			.mockRejectedValueOnce(new Error("connection refused"))
			.mockResolvedValue(new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", fetchMock);
		await expect(
			runUninstallHooks(
				configuredDb(),
				[hooked("alpha", "beta"), hooked("gamma", "beta")],
				"beta",
			),
		).resolves.toBeUndefined();
		expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("/clients/gamma");
	});
});
