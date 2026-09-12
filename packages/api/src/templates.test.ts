import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { Db } from "./db.js";
import { generateCompose } from "./lib/compose.js";
import { networkHosts } from "./lib/network.js";
import { checkRequirements } from "./lib/requirements.js";
import {
	ensureSecrets,
	getTemplateDefaults,
	getTemplates,
	loadTemplates,
	sortByDependencies,
} from "./lib/service-registry.js";
import type { ServiceTemplate } from "./lib/service-registry.js";
import { foreachSpec } from "./lib/setup-runner.js";
import { getStacks, loadStacks } from "./lib/stacks.js";
import { validateTemplate } from "./lib/template-schema.js";
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
	"stats",
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
	const steps = [
		...tpl.setup,
		...(tpl.uninstall ?? []).flatMap((hook) => hook.steps),
		...Object.values(tpl.actions ?? {}),
	];
	for (const step of steps) {
		if (step.store) keys.push(`internal.${step.store.as}`);
	}
	return keys;
}

describe("every template", () => {
	/*
	 * The loader now drops a file it cannot validate instead of crashing, which
	 * is the right behaviour for an upload and the wrong one to discover here:
	 * a shipped template refused at load would simply be absent, and every other
	 * assertion below would pass over its silence. So count the files, then read
	 * the reasons.
	 */
	it("is loaded, having passed the runtime validator", () => {
		const files = readdirSync(TEMPLATES).filter((f) => /\.ya?ml$/.test(f));
		for (const file of files) {
			const parsed = parse(readFileSync(resolve(TEMPLATES, file), "utf-8"));
			expect(validateTemplate(parsed), file).toEqual([]);
		}
		expect(templates).toHaveLength(files.length);
	});

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

	// A lock naming a service that does not exist can never be satisfied, which
	// makes the template uninstallable without saying why.
	it("only supports services that exist, in the category it names", () => {
		const byId = new Map(templates.map((t) => [t.id, t]));
		for (const tpl of templates) {
			for (const req of [...(tpl.requires ?? []), ...(tpl.recommends ?? [])]) {
				for (const id of req.supports ?? []) {
					const peer = byId.get(id);
					expect(peer, `${tpl.id} supports "${id}"`).toBeDefined();
					expect(peer?.category, `${tpl.id} supports "${id}"`).toBe(
						req.category,
					);
				}
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
	 * Deliberately one-way. A template without an icon is fine — `ServiceIcon`
	 * falls back, and a service dropped into a running install has no business
	 * failing a build. An icon whose template is gone is just dead weight, and
	 * nothing else will ever point it out.
	 */
	it("keeps no icon for a service that no longer exists", () => {
		const dir = resolve(import.meta.dirname, "../../web/src/icons");
		const drawn = readdirSync(dir)
			.filter((f) => f.endsWith(".svg"))
			.map((f) => f.replace(".svg", ""))
			// `_default` and `_runner` are the frontend's own, not services.
			.filter((id) => !id.startsWith("_"));
		for (const id of drawn) {
			expect(
				templates.map((t) => t.id),
				`icon "${id}.svg"`,
			).toContain(id);
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
	/*
	 * The engine substitutes `{{...}}` and escapes for nothing, so a credential
	 * spliced into a document a template builds by hand — an INI file, a JSON
	 * body written as a string — can end that document and start another. A
	 * `pattern` is the only thing standing in the way, and the API now enforces
	 * the ones a template declares (`lib/credential-rules.ts`).
	 *
	 * A structured `body:` is exempt on purpose: it is handed to
	 * `JSON.stringify` or `URLSearchParams`, which quote for you.
	 */
	it("gives a pattern to every credential it splices into a document", () => {
		/**
		 * Is this string a document the template wrote itself?
		 *
		 * A body value like `"{{credentials.user}}"` is one field of a mapping
		 * the runner hands to `JSON.stringify`, which quotes it. The same field
		 * inside `\'{"web_ui_username":"{{credentials.user}}"}\'` is not: that
		 * string *is* the JSON, and nothing will quote anything inside it. What
		 * separates them is punctuation of its own, once the placeholders are
		 * taken out.
		 */
		function isDocument(text: string): boolean {
			return /[{}"[\]]/.test(text.replace(/\{\{[^}]*\}\}/g, ""));
		}

		/** Strings a template writes verbatim, as opposed to encoding. */
		function handBuilt(tpl: ServiceTemplate): string[] {
			const strings: string[] = [];
			for (const step of [...tpl.setup, ...Object.values(tpl.actions ?? {})]) {
				// A config file is a document by definition — INI, JSON, XML.
				if (step.type === "config_file" && step.content) {
					strings.push(step.content);
				}
				for (const value of Object.values(
					(step.body as Record<string, unknown>) ?? {},
				)) {
					if (typeof value === "string" && isDocument(value)) {
						strings.push(value);
					}
				}
			}
			return strings;
		}

		for (const tpl of templates) {
			for (const text of handBuilt(tpl)) {
				// Both spellings: `{{credentials.key}}` is this template's own field,
				// `{{credentials.service.key}}` is a peer's — and a peer's value is
				// spliced into this template's document just the same.
				for (const m of text.matchAll(
					/\{\{credentials\.(\w+)(?:\.(\w+))?\}\}/g,
				)) {
					const [owner, key] = m[2]
						? [templates.find((t) => t.id === m[1]), m[2]]
						: [tpl, m[1]];
					const field = owner?.credentials?.find((f) => f.key === key);
					expect(
						field?.rules?.pattern,
						`${tpl.id}: ${m[0]} is written into a document verbatim`,
					).toBeTruthy();
				}
			}
		}
	});

	it("gives every select its options, with the default among them", () => {
		for (const tpl of templates) {
			for (const field of tpl.credentials ?? []) {
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
			// Setup steps write addresses too, and resolve the same hosts — and so
			// does `uninstall:`, which is a list of steps like any other. A section
			// left out here is a section where hardcoding a container name passes.
			const rendered = JSON.stringify([
				tpl.compose,
				tpl.setup,
				tpl.uninstall,
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

	/**
	 * A named volume must be declared at the top level or `docker compose up`
	 * refuses the whole file. The generator emits only what the templates
	 * declare, so an undeclared reference breaks every service, not just its own.
	 */
	it("declares every named volume its services reference", () => {
		for (const tpl of templates) {
			const declared = new Set(Object.keys(tpl.volumes ?? {}));
			for (const [name, service] of Object.entries(tpl.compose)) {
				for (const v of (service as { volumes?: string[] }).volumes ?? []) {
					const source = String(v).split(":")[0];
					// Bind mounts declare nothing. `{{paths.media}}` is one before it
					// resolves, and holds no slash yet — so it has to be skipped by
					// shape, not by looking for a separator that is not there.
					if (
						source.includes("/") ||
						source.startsWith(".") ||
						source.includes("{{")
					)
						continue;
					expect(declared.has(source), `${tpl.id}.${name}: ${source}`).toBe(
						true,
					);
				}
			}
		}
	});

	it("keeps named volumes unique across templates", () => {
		const seen = new Map<string, string>();
		for (const tpl of templates) {
			for (const name of Object.keys(tpl.volumes ?? {})) {
				expect(seen.has(name), `${name}: ${seen.get(name)} and ${tpl.id}`).toBe(
					false,
				);
				seen.set(name, tpl.id);
			}
		}
	});

	/**
	 * The card lays the glyph beside the title, so one stack without it leaves a
	 * ragged row. And an ASCII "icon" would be a name that nothing resolves —
	 * this field is printed verbatim, never looked up.
	 */
	it("gives every stack a short, non-ASCII emoji", () => {
		for (const stack of getStacks()) {
			expect(stack.emoji, `${stack.id}`).toBeTruthy();
			const glyph = stack.emoji ?? "";
			// Generous enough for a ZWJ sequence, tight enough to refuse a word.
			expect(glyph.length, `${stack.id}: ${glyph}`).toBeLessThanOrEqual(8);
			// biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to refuse ASCII
			expect(/^[\x00-\x7F]*$/.test(glyph), `${stack.id}: ${glyph}`).toBe(false);
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

/**
 * The gate on `after:`. The order used to be `readdirSync`'s — the alphabetical
 * order of the file names — and two `notes:` in production were that fact
 * written out as advice to the user.
 */
describe("the order templates are set up in", () => {
	it("puts every category a template waits on before it", () => {
		const position = new Map(templates.map((t, i) => [t.id, i]));
		for (const tpl of templates) {
			for (const dep of tpl.after ?? []) {
				for (const other of templates) {
					if (other.id === tpl.id || other.category !== dep.category) continue;
					expect(
						(position.get(other.id) ?? 0) < (position.get(tpl.id) ?? 0),
						`${tpl.id} waits on ${dep.category} but ${other.id} comes after it`,
					).toBe(true);
				}
			}
		}
	});

	// A cycle makes `sortByDependencies` give up and keep the file order, which is
	// logged but not fatal — so nothing else would ever point it out.
	it("has no cycle among the shipped templates", () => {
		const sorted = sortByDependencies(templates);
		expect(sorted.map((t) => t.id)).toEqual(templates.map((t) => t.id));
	});

	// The `notes:` it replaces said "Install Sonarr and Radarr before Seerr".
	it("no longer asks the user to install things in the right order", () => {
		for (const tpl of templates) {
			for (const note of tpl.notes ?? []) {
				expect(
					/install .* before/i.test(note),
					`${tpl.id} still states an install order in prose: "${note}"`,
				).toBe(false);
			}
		}
	});
});
