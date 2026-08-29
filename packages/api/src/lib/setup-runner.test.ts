import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db.js";
import { configuredDb } from "../test/fake-db.js";
import { template } from "../test/helpers.js";
import { loadTemplates } from "./service-registry.js";
import type { ServiceTemplate } from "./service-registry.js";
import { runTemplateSteps, stepKeys, stepPhase } from "./setup-runner.js";

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

	it("follows the libraries the user actually defined", () => {
		const db = configuredDb({
			libraries: JSON.stringify([{ name: "Anime", type: "tvshows" }]),
		});
		expect(stepKeys(db, template("alpha"))).toContain(
			"alpha.add_library_Anime",
		);
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
