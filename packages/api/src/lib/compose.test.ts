import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { Db } from "../db.js";
import { configuredDb } from "../test/fake-db.js";
import { generateCompose } from "./compose.js";
import { PUID } from "./env.js";
import { loadTemplates } from "./service-registry.js";

const FIXTURES = fileURLToPath(new URL("../test/fixtures", import.meta.url));

interface ComposeFile {
	services: Record<string, Record<string, unknown>>;
}

function render(db: Db): ComposeFile {
	return parse(generateCompose(db)) as ComposeFile;
}

function envOf(service: Record<string, unknown>): Record<string, string> {
	const entries = (service.environment as string[]) ?? [];
	return Object.fromEntries(
		entries.map((e) => {
			const at = e.indexOf("=");
			return [e.slice(0, at), e.slice(at + 1)];
		}),
	);
}

beforeAll(() => loadTemplates(FIXTURES));

describe("generateCompose", () => {
	it("emits nothing when no service is enabled", () => {
		expect(render(configuredDb()).services ?? {}).toEqual({});
	});

	it("includes only the enabled templates", () => {
		const out = render(configuredDb({ "services.alpha.enabled": true }));
		expect(Object.keys(out.services)).toEqual(["alpha"]);
	});

	it("emits every container a template declares, not just the named one", () => {
		const out = render(
			configuredDb({
				"services.alpha.enabled": true,
				"services.beta.enabled": true,
			}),
		);
		expect(Object.keys(out.services).sort()).toEqual([
			"alpha",
			"beta",
			"beta-db",
		]);
	});

	it("resolves host paths and env wiring", () => {
		const out = render(configuredDb({ "services.alpha.enabled": true }));
		expect(out.services.alpha.volumes).toEqual(["/srv/config/alpha:/config"]);
		expect(envOf(out.services.alpha).PUID).toBe(PUID);
	});

	it("hands one service's generated secret to another", () => {
		const out = render(
			configuredDb({
				"services.alpha.enabled": true,
				"services.beta.enabled": true,
			}),
		);
		const key = envOf(out.services.alpha).ALPHA__APIKEY;
		expect(key).toMatch(/^[0-9a-f]{16}$/);
		expect(envOf(out.services.beta).BETA__ALPHA__APIKEY).toBe(key);
	});

	it("hands one service's credential to another", () => {
		const out = render(
			configuredDb({
				"services.alpha.enabled": true,
				"services.beta.enabled": true,
				"credentials.alpha.user": "hugo",
			}),
		);
		expect(envOf(out.services.beta).BETA__ALPHA__USER).toBe("hugo");
	});

	it("exposes a peer's enable flag so a template can switch on it", () => {
		const on = render(
			configuredDb({
				"services.alpha.enabled": true,
				"services.beta.enabled": true,
			}),
		);
		expect(envOf(on.services.beta).BETA__ALPHA__ENABLED).toBe("true");

		const off = render(
			configuredDb({
				"services.alpha.enabled": false,
				"services.beta.enabled": true,
			}),
		);
		expect(envOf(off.services.beta).BETA__ALPHA__ENABLED).toBe("false");
	});

	it("drops an env entry whose value resolved to nothing", () => {
		const out = render(configuredDb({ "services.beta.enabled": true }));
		expect(envOf(out.services.beta)).not.toHaveProperty("BETA__OPTIONAL");
	});

	it("keeps an env entry the user did fill in", () => {
		const out = render(
			configuredDb({
				"services.beta.enabled": true,
				"credentials.beta.optional": "set",
			}),
		);
		expect(envOf(out.services.beta).BETA__OPTIONAL).toBe("set");
	});

	it("injects the libraries as JSON a container can parse", () => {
		const out = render(configuredDb({ "services.beta.enabled": true }));
		expect(JSON.parse(envOf(out.services.beta).BETA__MOVIES)).toEqual([
			{ name: "Movies", path: "/media/Movies" },
		]);
	});

	it("leaves compose's $$ escaping intact through the YAML round trip", () => {
		const out = render(configuredDb({ "services.beta.enabled": true }));
		const healthcheck = out.services["beta-db"].healthcheck as {
			test: string[];
		};
		expect(healthcheck.test[1]).toBe("pg_isready -d $${POSTGRES_DB}");
	});

	it("keeps a generated secret stable across regenerations", () => {
		const db = configuredDb({ "services.alpha.enabled": true });
		const first = envOf(render(db).services.alpha).ALPHA__APIKEY;
		expect(envOf(render(db).services.alpha).ALPHA__APIKEY).toBe(first);
	});

	it("mints every secret before rendering, not lazily per template", () => {
		// Alpha reads Zeta's token, but Zeta's template loads after Alpha's. A
		// single-pass render would emit an empty value here.
		const out = render(
			configuredDb({
				"services.alpha.enabled": true,
				"services.zeta.enabled": true,
			}),
		);
		const token = envOf(out.services.zeta).ZETA__TOKEN;
		expect(token).toMatch(/^[0-9a-f-]{36}$/);
		expect(envOf(out.services.alpha).ALPHA__ZETA_TOKEN).toBe(token);
	});

	it("does not mint the secret of a service left disabled", () => {
		const db = configuredDb({ "services.alpha.enabled": true });
		render(db);
		expect(db.get("internal.zeta.token")).toBeNull();
	});
});
