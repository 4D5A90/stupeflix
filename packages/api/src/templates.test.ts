import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db.js";
import {
	ensureSecrets,
	getTemplateDefaults,
	getTemplates,
	loadTemplates,
} from "./lib/service-registry.js";
import type { ServiceTemplate } from "./lib/service-registry.js";
import { buildVars } from "./lib/template-vars.js";
import { fakeDb } from "./test/fake-db.js";
import { lastStep, template } from "./test/helpers.js";

/**
 * These run against the real `templates/` directory. Since no code names a
 * service any more, a typo in a YAML file is the way this app breaks — and the
 * only thing standing between it and a container that fails to boot.
 */
const TEMPLATES = fileURLToPath(new URL("../../../templates", import.meta.url));

/** Categories the wizard knows how to label and order (web ServicesStep.tsx). */
const KNOWN_CATEGORIES = [
	"torrentClient",
	"indexer",
	"mediaManager",
	"mediaServer",
	"seeder",
];

let templates: ServiceTemplate[];
let db: Db;

beforeAll(() => {
	loadTemplates(TEMPLATES);
	templates = getTemplates();
	db = fakeDb({
		...getTemplateDefaults(),
		"paths.config": "/srv/config",
		"paths.media": "/srv/media",
		"paths.torrents": "/srv/torrents",
		libraries: JSON.stringify([
			{ name: "Movies", type: "movies" },
			{ name: "TvShows", type: "tvshows" },
		]),
	});
	for (const tpl of templates) ensureSecrets(db, tpl);
});

/** Every `{{...}}` reference anywhere in a template. */
function referencedVars(
	value: unknown,
	found = new Set<string>(),
): Set<string> {
	if (typeof value === "string") {
		for (const m of value.matchAll(/\{\{(\w+(?:\.\w+)*)\}\}/g)) found.add(m[1]);
	} else if (Array.isArray(value)) {
		for (const v of value) referencedVars(v, found);
	} else if (value && typeof value === "object") {
		for (const v of Object.values(value)) referencedVars(v, found);
	}
	return found;
}

/** Variables a step produces at runtime, which buildVars cannot know up front. */
function runtimeVars(tpl: ServiceTemplate): string[] {
	const keys: string[] = [];
	for (const step of [...tpl.setup, ...Object.values(tpl.actions ?? {})]) {
		if (step.storeAs) keys.push(`internal.${step.storeAs}`);
		if (step.storeToken) keys.push("internal.token");
	}
	return keys;
}

describe("every template", () => {
	it("declares the fields the engine needs", () => {
		for (const tpl of templates) {
			expect(tpl.id, `${tpl.id}: id`).toMatch(/^[a-z0-9-]+$/);
			expect(tpl.name, `${tpl.id}: name`).toBeTruthy();
			expect(tpl.container, `${tpl.id}: container`).toBeTruthy();
			expect(typeof tpl.port, `${tpl.id}: port`).toBe("number");
			expect(
				Object.keys(tpl.compose ?? {}).length,
				`${tpl.id}: compose`,
			).toBeGreaterThan(0);
		}
	});

	it("uses a category the wizard can render", () => {
		for (const tpl of templates) {
			expect(KNOWN_CATEGORIES, `${tpl.id}`).toContain(tpl.category);
		}
	});

	it("names a compose service matching `container`", () => {
		// routes/services.ts runs `docker compose start <container>` on this name
		for (const tpl of templates) {
			expect(Object.keys(tpl.compose), `${tpl.id}`).toContain(tpl.container);
		}
	});

	it("gives that container a container_name matching it", () => {
		// index.ts /status runs `docker inspect <container>`, which resolves by name
		for (const tpl of templates) {
			const main = tpl.compose[tpl.container] as { container_name?: string };
			expect(main.container_name, `${tpl.id}`).toBe(tpl.container);
		}
	});

	it("writes config files with both a path and a body", () => {
		for (const tpl of templates) {
			for (const step of tpl.setup) {
				if (step.type !== "config_file") continue;
				expect(step.file, `${tpl.id}.${step.name}: file`).toBeTruthy();
				expect(step.content, `${tpl.id}.${step.name}: content`).toBeTruthy();
			}
		}
	});

	it("writes notes as plain sentences the UI can render as-is", () => {
		for (const tpl of templates) {
			for (const note of tpl.notes ?? []) {
				expect(typeof note, `${tpl.id}`).toBe("string");
				expect(note.trim().length, `${tpl.id}: empty note`).toBeGreaterThan(0);
				// The tooltip renders text, not markup or markdown: anything the
				// author meant as formatting would show up literally
				expect(note, `${tpl.id}: markup in note`).not.toMatch(/[<>`*_]/);
				expect(note, `${tpl.id}: unresolved variable in note`).not.toMatch(
					/\{\{/,
				);
			}
			const notes = tpl.notes ?? [];
			expect(new Set(notes).size, `${tpl.id}: duplicate note`).toBe(
				notes.length,
			);
		}
	});

	it("gives every step a unique name, so statuses cannot collide", () => {
		for (const tpl of templates) {
			const names = tpl.setup.map((s) => s.name);
			expect(new Set(names).size, `${tpl.id}`).toBe(names.length);
		}
	});

	it("labels every action, since the dashboard shows it as the tooltip", () => {
		for (const tpl of templates) {
			for (const [id, action] of Object.entries(tpl.actions ?? {})) {
				expect(action.label, `${tpl.id} action "${id}"`).toBeTruthy();
			}
		}
	});

	/**
	 * Icon names are case-sensitive and an unknown one silently falls back to the
	 * default, so a typo is invisible at runtime. The list lives in the web
	 * package's ActionIcon.tsx and is documented in the README.
	 */
	it("only names action icons the dashboard actually draws", () => {
		const source = readFileSync(
			resolve(
				import.meta.dirname,
				"../../web/src/components/ui/ActionIcon.tsx",
			),
			"utf-8",
		);
		const registry = source.slice(
			source.indexOf("const icons"),
			source.indexOf("const defaultIcon"),
		);
		const known = new Set(
			[...registry.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]),
		);
		expect(known.size).toBeGreaterThan(0);
		for (const tpl of templates) {
			for (const [id, action] of Object.entries(tpl.actions ?? {})) {
				if (!action.icon) continue;
				expect(known, `${tpl.id} action "${id}"`).toContain(action.icon);
			}
		}
	});

	it("only references variables that actually resolve", () => {
		for (const tpl of templates) {
			const known = new Set([
				...Object.keys(buildVars(db, tpl.id)),
				...runtimeVars(tpl),
			]);
			for (const ref of referencedVars(tpl)) {
				if (ref.startsWith("library.")) continue; // injected per foreach iteration
				expect(known, `${tpl.id} references {{${ref}}}`).toContain(ref);
			}
		}
	});

	it("only points `{{services.x.enabled}}` at a service that exists", () => {
		const ids = new Set(templates.map((t) => t.id));
		for (const tpl of templates) {
			for (const ref of referencedVars(tpl)) {
				const match = ref.match(/^services\.(.+)\.enabled$/);
				if (match) expect(ids, `${tpl.id}`).toContain(match[1]);
			}
		}
	});
});

describe("across templates", () => {
	it("keeps compose service names unique", () => {
		const seen = new Map<string, string>();
		for (const tpl of templates) {
			for (const name of Object.keys(tpl.compose)) {
				expect(
					seen.has(name),
					`${name} declared by ${seen.get(name)} and ${tpl.id}`,
				).toBe(false);
				seen.set(name, tpl.id);
			}
		}
	});

	it("keeps published host ports unique per protocol", () => {
		const seen = new Map<string, string>();
		for (const tpl of templates) {
			for (const [name, service] of Object.entries(tpl.compose)) {
				for (const p of (service as { ports?: string[] }).ports ?? []) {
					// "6881:6881" and "6881:6881/udp" are the same port, not a clash
					const port = `${String(p).split(":")[0]}/${String(p).endsWith("/udp") ? "udp" : "tcp"}`;
					expect(seen.has(port), `${port}: ${seen.get(port)} and ${name}`).toBe(
						false,
					);
					seen.set(port, name);
				}
			}
		}
	});

	it("keeps template ids unique", () => {
		const ids = templates.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe("mediamanager", () => {
	const env = (tpl: ServiceTemplate) =>
		(
			(tpl.compose.mediamanager as { environment: string[] }).environment ?? []
		).map((e) => e.split("=")[0]);

	it("configures itself only through MEDIAMANAGER_* variables", () => {
		// Its settings model rejects unknown keys, so a stray prefix is a boot failure
		const tpl = template("mediamanager");
		const unexpected = env(tpl).filter(
			(k) =>
				!k.startsWith("MEDIAMANAGER_") && !["TZ", "CONFIG_DIR"].includes(k),
		);
		expect(unexpected).toEqual([]);
	});

	it("writes no config file, since env wins over the TOML", () => {
		const tpl = template("mediamanager");
		expect(tpl.setup.filter((s) => s.type === "config_file")).toEqual([]);
	});

	it("ends its pipeline on a strict credential check", () => {
		// The steps before it tolerate failure; this one is what proves the admin
		// answers to the password the wizard showed the user
		const tpl = template("mediamanager");
		const last = lastStep(tpl);
		expect(last.name).toBe("verify_login");
		expect(last.ignoreStatus).toBeUndefined();
	});
});
