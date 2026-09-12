import { fileURLToPath } from "node:url";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { configuredDb } from "../test/fake-db.js";
import { template } from "../test/helpers.js";
import { runCompose } from "./docker-cli.js";
import {
	removalCommand,
	removeService,
	runServiceInstall,
} from "./service-install.js";
import { getTemplate, loadTemplates } from "./service-registry.js";
import type { ServiceTemplate } from "./service-registry.js";

// The two collaborators that reach outside: one writes the compose file, the
// other runs docker. Everything else about a removal is bookkeeping.
vi.mock("./docker-cli.js", () => ({ runCompose: vi.fn(async () => ({})) }));
vi.mock("./compose.js", () => ({ writeCompose: vi.fn() }));

const FIXTURES = fileURLToPath(new URL("../test/fixtures", import.meta.url));
beforeAll(() => loadTemplates(FIXTURES));
beforeEach(() => vi.clearAllMocks());

describe("removalCommand", () => {
	it("reconciles while services remain", () => {
		expect(removalCommand(2)).toEqual(["up", "-d", "--remove-orphans"]);
	});

	it("comes down when none do", () => {
		// `up` on `services: {}` is "no service selected", and a bare `down` on
		// that file is a no-op — it reads the file, not the project.
		expect(removalCommand(0)).toEqual(["down", "--remove-orphans"]);
	});

	it("never carries -v, so a template's database keeps its data", () => {
		for (const remaining of [0, 1, 5]) {
			expect(removalCommand(remaining)).not.toContain("-v");
		}
	});
});

describe("removeService", () => {
	it("disables the service and reconciles, with others still installed", async () => {
		const db = configuredDb({
			"services.alpha.enabled": true,
			"services.beta.enabled": true,
		});
		await removeService(db, template("alpha"));
		expect(db.get("services.alpha.enabled")).toBe(false);
		expect(db.get("services.beta.enabled")).toBe(true);
		expect(runCompose).toHaveBeenCalledWith(["up", "-d", "--remove-orphans"]);
	});

	it("comes down when it was the last one", async () => {
		// The regression: the API reported the service removed, Compose refused
		// the empty file, and the container kept running with its ports held.
		const db = configuredDb({ "services.alpha.enabled": true });
		await removeService(db, template("alpha"));
		expect(runCompose).toHaveBeenCalledWith(["down", "--remove-orphans"]);
	});
});

/**
 * "Did this service exist before this operation?" is what decides whether a
 * failure should undo the install. The flag used to be written by
 * `routes/install.ts` before the installer read it, so the answer was always
 * yes — and a failed first install left the service marked installed, showing on
 * the dashboard as exited and no longer offered under "Add service".
 */
describe("runServiceInstall on failure", () => {
	const failing = () => {
		vi.mocked(runCompose).mockRejectedValue(new Error("docker is not there"));
		return getTemplate("eta") as ServiceTemplate;
	};

	it("undoes a first install that never completed", async () => {
		const db = configuredDb();
		await runServiceInstall(db, failing());
		expect(db.get("services.eta.enabled")).toBe(false);
		expect(db.get("setup.global")).toBe("failed");
	});

	it("leaves a service the user already had installed", async () => {
		const db = configuredDb({ "services.eta.enabled": true });
		await runServiceInstall(db, failing());
		expect(db.get("services.eta.enabled")).toBe(true);
		expect(db.get("setup.global")).toBe("failed");
	});
});

/**
 * "Did this service exist before this operation?" is what decides whether a
 * failure should undo the install. The flag used to be written by
 * `routes/install.ts` before the installer read it, so the answer was always
 * yes — and a failed first install left the service marked installed, showing on
 * the dashboard as exited and no longer offered under "Add service".
 */
describe("runServiceInstall on failure", () => {
	const failing = () => {
		vi.mocked(runCompose).mockRejectedValue(new Error("docker is not there"));
		return getTemplate("eta") as ServiceTemplate;
	};

	it("undoes a first install that never completed", async () => {
		const db = configuredDb();
		await runServiceInstall(db, failing());
		expect(db.get("services.eta.enabled")).toBe(false);
		expect(db.get("setup.global")).toBe("failed");
	});

	it("leaves a service the user already had installed", async () => {
		const db = configuredDb({ "services.eta.enabled": true });
		await runServiceInstall(db, failing());
		expect(db.get("services.eta.enabled")).toBe(true);
		expect(db.get("setup.global")).toBe("failed");
	});
});
