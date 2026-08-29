import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../db.js";
import { configuredDb } from "../test/fake-db.js";
import { template } from "../test/helpers.js";
import { cleanConfigs, cleanServiceConfig } from "./helpers.js";
import {
	getGeneratedConfigFiles,
	getTemplateConfigFiles,
	getTemplateResetDirs,
	loadTemplates,
} from "./service-registry.js";

const FIXTURES = fileURLToPath(new URL("../test/fixtures", import.meta.url));

beforeAll(() => loadTemplates(FIXTURES));

let dir: string;
let db: Db;

function seed() {
	mkdirSync(join(dir, "alpha"), { recursive: true });
	writeFileSync(join(dir, "alpha/alpha.conf"), "generated");
	writeFileSync(join(dir, "alpha/leftover.db"), "state");
	mkdirSync(join(dir, "beta"), { recursive: true });
	writeFileSync(join(dir, "beta/keep.conf"), "hand written");
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "stupeflix-cfg-"));
	db = configuredDb({ "paths.config": dir });
	seed();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("per-template reset lists", () => {
	it("returns only the files that template declares writing", () => {
		expect(getTemplateConfigFiles(db, template("alpha"))).toEqual([
			"alpha/alpha.conf",
		]);
		expect(getTemplateConfigFiles(db, template("beta"))).toEqual([]);
	});

	it("keeps the global list as the union of them", () => {
		expect(getGeneratedConfigFiles(db)).toContain("alpha/alpha.conf");
	});

	it("returns only that template's reset directories", () => {
		expect(getTemplateResetDirs(template("alpha"))).toEqual(["alpha"]);
		expect(getTemplateResetDirs(template("beta"))).toEqual([]);
	});
});

describe("cleanServiceConfig", () => {
	it("drops what the template generated and empties its reset directory", () => {
		cleanServiceConfig(db, template("alpha"));
		expect(existsSync(join(dir, "alpha/alpha.conf"))).toBe(false);
		// `reset.dirs` wipes the directory but must leave it in place to boot into
		expect(existsSync(join(dir, "alpha"))).toBe(true);
		expect(readdirSync(join(dir, "alpha"))).toEqual([]);
	});

	/**
	 * The whole point of the scoping: reconfiguring one service must not replay
	 * another's startup wizard.
	 */
	it("leaves every other service alone", () => {
		cleanServiceConfig(db, template("beta"));
		expect(existsSync(join(dir, "alpha/alpha.conf"))).toBe(true);
		expect(existsSync(join(dir, "alpha/leftover.db"))).toBe(true);
		expect(existsSync(join(dir, "beta/keep.conf"))).toBe(true);
	});

	it("does nothing at all when no config path is set yet", () => {
		cleanServiceConfig(configuredDb({ "paths.config": "" }), template("alpha"));
		expect(existsSync(join(dir, "alpha/alpha.conf"))).toBe(true);
	});
});

describe("cleanConfigs", () => {
	it("still clears every template at once, unlike the scoped version", () => {
		cleanConfigs(db);
		expect(existsSync(join(dir, "alpha/alpha.conf"))).toBe(false);
		expect(readdirSync(join(dir, "alpha"))).toEqual([]);
		// beta declares nothing, so its files are user data and survive
		expect(existsSync(join(dir, "beta/keep.conf"))).toBe(true);
	});
});
