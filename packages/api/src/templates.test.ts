import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "./db.js";
import { generateCompose } from "./lib/compose.js";
import { networkHosts } from "./lib/network.js";
import { checkRequirements } from "./lib/requirements.js";
import {
	ensureSecrets,
	getTemplateDefaults,
	getTemplates,
	loadTemplates,
} from "./lib/service-registry.js";
import type { ServiceTemplate } from "./lib/service-registry.js";
import { foreachSpec } from "./lib/setup-runner.js";
import { getStacks, loadStacks } from "./lib/stacks.js";
import { buildVars } from "./lib/template-vars.js";
import { fakeDb } from "./test/fake-db.js";

/**
 * These run against the real `templates/` directory. Since no code names a
 * service any more, a typo in a YAML file is the way this app breaks — and the
 * only thing standing between it and a container that fails to boot.
 */
const TEMPLATES = fileURLToPath(new URL("../../../templates", import.meta.url));
const STACKS = fileURLToPath(new URL("../../../stacks", import.meta.url));

/** Collections `expandStep` knows how to walk (lib/setup-runner.ts). */
const KNOWN_FOREACH_SOURCES = ["libraries"];

/** Categories the wizard knows how to label and order (web ServicesStep.tsx). */
const KNOWN_CATEGORIES = [
	"torrentClient",
	"indexer",
	"mediaManager",
	"mediaServer",
	"requests",
	"seeder",
	"vpn",
];

let templates: ServiceTemplate[];
let db: Db;

beforeAll(() => {
	loadTemplates(TEMPLATES);
	loadStacks(STACKS);
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
			// Optional: a headless service has no web UI to point at
			if (tpl.port !== undefined) {
				expect(typeof tpl.port, `${tpl.id}: port`).toBe("number");
			}
			expect(
				Object.keys(tpl.compose ?? {}).length,
				`${tpl.id}: compose`,
			).toBeGreaterThan(0);
		}
	});

	// A step declaring a source the runner does not know runs once, silently,
	// as if it had no loop at all — the kind of typo only a gate catches.
	it("only iterates a source the runner implements", () => {
		for (const tpl of templates) {
			for (const step of tpl.setup) {
				const spec = foreachSpec(step);
				if (!spec) continue;
				expect(KNOWN_FOREACH_SOURCES, `${tpl.id}.${step.name}`).toContain(
					spec.source,
				);
			}
		}
	});

	it("uses a category the wizard can render", () => {
		for (const tpl of templates) {
			expect(KNOWN_CATEGORIES, `${tpl.id}`).toContain(tpl.category);
		}
	});

	// A dependency names a category, never a service — so the only way it can be
	// wrong is by naming a category nothing provides, which would block the
	// wizard on a box the user has no way to tick.
	it("only requires categories some template actually provides", () => {
		const provided = new Set(templates.map((t) => t.category));
		for (const tpl of templates) {
			for (const req of [...(tpl.requires ?? []), ...(tpl.recommends ?? [])]) {
				expect(provided, `${tpl.id} requires`).toContain(req.category);
			}
		}
	});

	it("never depends on its own category, which it satisfies itself", () => {
		for (const tpl of templates) {
			for (const req of [...(tpl.requires ?? []), ...(tpl.recommends ?? [])]) {
				expect(req.category, `${tpl.id}`).not.toBe(tpl.category);
			}
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
		// Indentation-agnostic on purpose: this reads the web source as data, and a
		// formatter run must not be able to turn the assertion into a no-op.
		const known = new Set(
			[...registry.matchAll(/^[\t ]+(\w+):/gm)].map((m) => m[1]),
		);
		expect(known.size).toBeGreaterThan(0);
		for (const tpl of templates) {
			for (const [id, action] of Object.entries(tpl.actions ?? {})) {
				if (!action.icon) continue;
				expect(known, `${tpl.id} action "${id}"`).toContain(action.icon);
			}
		}
	});

	/**
	 * A `join` nobody provides is inert by design — that is what makes the VPN
	 * optional. But a typo is inert too, and silently so, which is why the
	 * capability has to exist somewhere in the directory.
	 */
	/**
	 * The list belongs to the template, so nothing in the code can validate its
	 * contents — but an empty one renders a dead field, and a default outside it
	 * silently submits a value the service will reject.
	 */
	it("gives every select its options, with the default among them", () => {
		for (const tpl of templates) {
			for (const field of tpl.credentials) {
				if (field.type !== "select") continue;
				const values = (field.options ?? []).map((o) => o.value);
				expect(
					values.length,
					`${tpl.id}.${field.key} has no options`,
				).toBeGreaterThan(0);
				if (field.default === undefined) continue;
				expect(values, `${tpl.id}.${field.key} default`).toContain(
					field.default,
				);
			}
		}
	});

	it("only joins a network some template provides", () => {
		const provided = new Set(
			templates.map((t) => t.network?.provides).filter(Boolean),
		);
		for (const tpl of templates) {
			const wanted = tpl.network?.join;
			if (!wanted) continue;
			expect(provided, `${tpl.id} joins "${wanted}"`).toContain(wanted);
		}
	});

	/** A joiner waits on `service_healthy`, so the provider has to report health. */
	it("gives every network provider a healthcheck", () => {
		for (const tpl of templates) {
			if (!tpl.network?.provides) continue;
			const primary = tpl.compose[tpl.container] as Record<string, unknown>;
			expect(primary?.healthcheck, `${tpl.id}`).toBeTruthy();
		}
	});

	/**
	 * Docker rejects these on a container sharing a namespace, and only
	 * `networks` is caught by `docker compose config` — the rest blow up at `up`.
	 */
	it("keeps namespace settings off a service that joins one", () => {
		const forbidden = [
			"networks",
			"hostname",
			"links",
			"dns",
			"dns_search",
			"extra_hosts",
		];
		for (const tpl of templates) {
			if (!tpl.network?.join) continue;
			const primary = (tpl.compose[tpl.container] ?? {}) as Record<
				string,
				unknown
			>;
			for (const key of forbidden) {
				expect(primary, `${tpl.id} declares ${key}`).not.toHaveProperty(key);
			}
		}
	});

	/**
	 * Hardcoding a peer's container name is correct only by coincidence: the day
	 * that peer joins a VPN it loses its own DNS name, and the reference breaks
	 * without an error. `{{host.<id>}}` follows it wherever it ends up.
	 */
	it("addresses a peer through {{host.x}}, never by its container name", () => {
		const peers = new Map(templates.map((t) => [t.container, t.id]));
		for (const tpl of templates) {
			// Setup steps write addresses too, and resolve the same hosts
			const rendered = JSON.stringify([
				tpl.compose,
				tpl.setup,
				tpl.actions,
				tpl.info,
			]);
			for (const [container, id] of peers) {
				if (id === tpl.id) continue; // its own containers are its business
				expect(
					rendered.includes(`//${container}:`) ||
						rendered.includes(`//${container}"`),
					`${tpl.id} hardcodes "${container}" — use {{host.${id}}}`,
				).toBe(false);
			}
		}
	});

	it("only references variables that actually resolve", () => {
		for (const tpl of templates) {
			const known = new Set([
				...Object.keys(buildVars(db, tpl.id)),
				...Object.keys(networkHosts(templates, { joins: new Map() })),
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

	/**
	 * Ports are moved, never copied, so the per-template uniqueness above already
	 * covers the merged file. What this adds is that the whole directory renders
	 * at once — two providers of one capability, or a forbidden key on a joiner,
	 * throw here rather than at the user's `docker compose up`.
	 */
	it("renders a valid compose file with every template enabled", () => {
		const all = fakeDb({
			...db.all(),
			...Object.fromEntries(
				templates.map((t) => [`services.${t.id}.enabled`, true]),
			),
		});
		expect(() => generateCompose(all)).not.toThrow();
	});

	it("keeps template ids unique", () => {
		const ids = templates.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

/**
 * A stack is an offer: pick this set and it works. Nothing in the app checks
 * that at runtime — the stack path deliberately has no alert region — so the
 * proof has to happen here, or an unusable combination ships as a one-click
 * recommendation.
 */
describe("stacks", () => {
	it("names only services that exist", () => {
		const known = new Set(templates.map((t) => t.id));
		for (const stack of getStacks()) {
			for (const id of stack.services) {
				expect(known, `${stack.id} names "${id}"`).toContain(id);
			}
		}
	});

	it("leaves no requirement unmet, so the stack path never has to warn", () => {
		for (const stack of getStacks()) {
			const { missing } = checkRequirements(templates, stack.services);
			expect(
				missing,
				`${stack.id}: ${missing.map((m) => m.reason).join(" ")}`,
			).toHaveLength(0);
		}
	});

	it("carries the two things the card renders", () => {
		for (const stack of getStacks()) {
			expect(stack.name, `${stack.id} name`).toBeTruthy();
			expect(stack.description, `${stack.id} description`).toBeTruthy();
			expect(stack.services.length, `${stack.id} services`).toBeGreaterThan(0);
		}
	});

	it("has unique ids", () => {
		const ids = getStacks().map((s) => s.id);
		expect(ids).toEqual([...new Set(ids)]);
	});
});
