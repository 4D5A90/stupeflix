import { randomBytes, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import type { Db } from "../db.js";
import { runComposeSync } from "./docker-cli.js";
import { debug, log, error as logError } from "./logger.js";
import { networkHosts, resolveNetworkTopology } from "./network.js";
import { underRoot } from "./safe-path.js";
import { isOwnHost, serviceUrl } from "./service-url.js";
import { validateTemplate } from "./template-schema.js";
import { buildVars, resolveTemplateVars } from "./template-vars.js";

// ── YAML schema types ──

export interface FieldRules {
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	message?: string;
}

export interface SelectOption {
	value: string;
	label: string;
}

export interface CredentialField {
	key: string;
	type: "text" | "password" | "email" | "select";
	label: string;
	/**
	 * `select` only. The list belongs to the template, never to the frontend —
	 * otherwise the wizard would have to know what a VPN provider is.
	 */
	options?: SelectOption[];
	default?: string;
	/**
	 * Shown greyed inside the empty field. For a value whose *shape* matters but
	 * whose content cannot be guessed — a plausible default there would look
	 * filled in and be wrong.
	 */
	placeholder?: string;
	/**
	 * `password` only. `false` for a secret the wizard cannot invent because it
	 * must match a value held elsewhere — a VPN key, a provider's token. Minting
	 * one would fill the field with something that is wrong.
	 */
	generate?: boolean;
	required?: boolean;
	rules?: FieldRules;
}

/** A secret minted once and kept in `internal.<service>.<key>` for later runs. */
export interface SecretDef {
	key: string;
	type?: "hex" | "uuid";
	/** Bytes of entropy for `hex` (default 32, so a 64-char string). */
	length?: number;
}

/**
 * What a step iterates, and how. Every option lives under here rather than
 * beside it, so an option that only makes sense for one source never becomes
 * part of the vocabulary every template has to read: `type` means something to
 * `libraries` and would mean nothing to whatever source comes next.
 *
 * It also makes the invalid state unwritable — a filter with no loop to filter.
 */
export interface ForeachSpec {
	/** The collection to walk. `libraries` is the only one so far. */
	source: string;
	/**
	 * `libraries`: keep only the libraries of this type. A service that handles
	 * one medium — Sonarr has nothing to do with a Movies folder — would
	 * otherwise be handed every library the user declared.
	 */
	type?: string;
	/** `libraries`: per-type values, injected as `{{library.<key>}}`. */
	map?: Record<string, Record<string, string>>;
}

/**
 * Where a value is read from, and what to call it once stored under
 * `internal.<service>.<as>`.
 *
 * One shape for what used to be four: `storeToken` plus `storeAs` for a JSON
 * response, `storeCookie` for a header, and two whole step types —
 * `extract_from_logs` and `extract_from_config` — whose only job was to read a
 * value and keep it. Those two differed by *where* they read, which is a
 * parameter, not a kind of step.
 *
 * `storeToken` also lied: it was a path into the response body, and carried
 * "Token" only because `storeAs` defaulted to `token`. `jellyfin.yml` already
 * used it to keep an API key.
 *
 * Every option lives under here rather than beside it, the way `foreach` does:
 * `container` means something to `logs` and nothing to `body`, so it has no
 * business in the vocabulary every template reads.
 */
export interface StoreSpec {
	/**
	 * `body` and `cookie` read an `api_call`'s response; `logs` and `file` are a
	 * step of their own (`type: store`) and read from outside the API entirely.
	 */
	from: "body" | "cookie" | "logs" | "file";
	/** `body`: dot path into the JSON response — `Items.0.AccessToken`. */
	path?: string;
	/** `logs` and `file`: the value is capture group 1. */
	regex?: string;
	/** `logs`: which container to read, both streams merged. */
	container?: string;
	/** `file`: path under `paths.config`. */
	file?: string;
	/**
	 * Destination under `internal.<service>.`. Always written out, never
	 * defaulted: a session token and a permanent API key must not share a slot —
	 * the first expires, the second is what has to outlive setup.
	 */
	as: string;
}

export interface SetupStepDef {
	name: string;
	label: string;
	type: "config_file" | "api_call" | "wait_ready" | "store";
	/**
	 * Resolved like any other value, and the step runs only when it comes out
	 * `"true"`. This is what makes a `recommends:` peer usable: it may be
	 * absent, and the steps that talk to it must then not exist at all.
	 *
	 * A list means every condition has to hold — wiring two services together
	 * needs both of them present.
	 */
	if?: string | string[];
	url?: string;
	method?: string;
	headers?: Record<string, string>;
	body?: unknown;
	contentType?: "json" | "form";
	/** Read a value out of this step and keep it. See `StoreSpec`. */
	store?: StoreSpec;
	useCookie?: boolean;
	/**
	 * Send the token this service handed us, in the header shape the service
	 * expects — the value is `{{internal.token}}`, resolved like any other.
	 *
	 * The shape belongs to the template, not to the engine: it used to be a
	 * boolean, and the engine wrote `MediaBrowser Token="…"` — a Jellyfin string
	 * living under `src/`, which is exactly what "no file under `src/` names a
	 * service" forbids. A service speaking `Bearer` could not use this at all.
	 */
	useToken?: string;
	/**
	 * Repeat this step over a collection. `foreach: libraries` is shorthand for
	 * `foreach: { source: libraries }`.
	 */
	foreach?: string | ForeachSpec;
	retryOn?: number[];
	maxRetries?: number;
	ignoreStatus?: number[];
	/** `wait_ready` only: poll until the response body matches this regex. */
	match?: string;
	/**
	 * Probe run before the step: when the response body matches, the step is a
	 * no-op. For APIs with no "create if absent", which answer a duplicate with
	 * a second copy instead of a conflict.
	 */
	skipIf?: { url: string; match: string };
	/**
	 * `api_call` only: read the resource first and merge `body` into it, instead
	 * of sending `body` alone. For APIs that accept nothing but the whole object
	 * on a write — Radarr's quality profile carries a list of qualities that
	 * differs between versions, so a template can neither send it verbatim nor
	 * omit it. Merging is shallow, by top-level key.
	 */
	merge?: boolean;
	/** `config_file` only: path under `paths.config`. */
	file?: string;
	/** File body for `config_file`. Template variables are resolved. */
	content?: string;
	/** `config_file` only: leave an existing file alone (default true). */
	skipIfExists?: boolean;
	/**
	 * A step whose failure is not the template's failure. It records `skipped`
	 * and the pipeline goes on.
	 *
	 * For the work a service only needs done once. qBittorrent prints a temporary
	 * password on a *virgin* boot and never again, so the three steps that trade
	 * it for real credentials have nothing to do on a service whose config
	 * survived a removal — and failing there would strand an install that had
	 * nothing left to do.
	 *
	 * Not a blanket property of a step type: Plex failing to yield its token is a
	 * genuine failure, and the same `store` step must keep saying so.
	 */
	optional?: boolean;
	/**
	 * `actions` only: which icon the dashboard draws on the button. Names are
	 * case-sensitive and listed in the README; an unknown one falls back to the
	 * default action icon rather than breaking the button.
	 */
	icon?: string;
}

/**
 * Steps to run when a *peer* is removed, declared by the template that holds the
 * entry.
 *
 * The rule that decides where these live: **clean up where the entry is, and do
 * it when the thing it points at disappears.** Sonarr writes a download client
 * into its own database pointing at qBittorrent, so removing qBittorrent leaves
 * Sonarr holding a dead entry — and only Sonarr's API can drop it.
 *
 * Removing Sonarr itself needs nothing here: the entry goes with the database
 * that held it.
 *
 * Grouped by `when` rather than carrying it per step, so the trigger is written
 * once and `SetupStepDef` stays what it is everywhere else.
 */
export interface UninstallHook {
	/** The service whose removal runs these steps. */
	when: string;
	steps: SetupStepDef[];
}

/**
 * A value the service reports about itself, shown on its dashboard card.
 * Complements `actions:` — an action does something and returns nothing, a
 * readout is something and does nothing.
 */
export interface InfoField {
	name: string;
	label: string;
	/** Polled through the API, so template variables and `serviceUrl()` apply. */
	url: string;
	/** Dotted path into the JSON body. Omitted, the whole body is used as text. */
	extract?: string;
	/** Seconds between refreshes. An exit IP is not a download rate. */
	refresh?: number;
}

/**
 * A dependency on a *category*, never on a named service — the same reason
 * `network:` matches a `join` to a `provides` by capability. A future
 * `emby.yml` satisfies Seerr's need for a media server without either file
 * being touched.
 */
export interface Requirement {
	category: string;
	/**
	 * The members of that category this template actually knows how to wire.
	 * Omitted, any of them will do — which is right for a category whose members
	 * are interchangeable, like a media server behind Seerr.
	 *
	 * Given, it is a lock: the template declares the combinations it was built
	 * and tested against, and the wizard refuses the others rather than
	 * installing a service that would quietly do nothing. It is also how a
	 * template declines to support a peer that is too complex or too poorly
	 * maintained to be worth it.
	 */
	supports?: string[];
	/** Shown when nothing in the category is installed at all. */
	reason?: string;
}

export interface ServiceTemplate {
	id: string;
	name: string;
	description: string;
	category: string;
	defaultEnabled: boolean;
	container: string;
	/**
	 * Where its web UI answers. Omitted by a headless service — a VPN tunnel has
	 * a control API but nothing to open, and the dashboard then offers no link.
	 */
	port?: number;
	webUiPath?: string;
	/**
	 * What setup cannot do for the user: a step they must take by hand, or a
	 * quirk of the service worth warning about. Surfaced as a tooltip.
	 */
	notes?: string[];
	/** Categories this service cannot work without: an unmet one blocks install. */
	requires?: Requirement[];
	/** Categories it runs without but poorly: an unmet one only warns. */
	recommends?: Requirement[];
	/** Compose services this template owns, verbatim, with template variables. */
	compose: Record<string, unknown>;
	/**
	 * Named volumes this template's services reference. Reserved for storage a
	 * database engine owns and nobody edits by hand — anything readable belongs
	 * under `paths.config` as a bind mount, where a backup can reach it.
	 */
	volumes?: Record<string, unknown>;
	generate?: SecretDef[];
	/** Directories under `paths.config` created before the container starts. */
	dirs?: string[];
	/** Directories under `paths.config` wiped on reconfigure, to replay a startup wizard. */
	reset?: { dirs?: string[] };
	/** Absent when the service asks the user for nothing of its own. */
	credentials?: CredentialField[];
	setup: SetupStepDef[];
	/** What to undo when a peer this service wired itself to is removed. */
	uninstall?: UninstallHook[];
	/** On-demand steps the dashboard can trigger after setup, e.g. `scan`. */
	actions?: Record<string, SetupStepDef>;
	/**
	 * How this service reaches the network. `provides` names a capability whose
	 * namespace it lends (a VPN tunnel); `join` asks for one. Neither side names
	 * the other, so a template works with or without a provider installed — see
	 * `lib/network.ts`.
	 */
	network?: { provides?: string; join?: string };
	/** Values the dashboard polls and displays, beyond the container's state. */
	info?: InfoField[];
}

// ── Public API sent to frontend ──

export interface ServiceMeta {
	id: string;
	name: string;
	description: string;
	category: string;
	defaultEnabled: boolean;
	notes: string[];
	requires: Requirement[];
	recommends: Requirement[];
	credentials: CredentialField[];
}

// ── Loader ──

let templates: ServiceTemplate[] = [];
let templatesDir = "";

export function loadTemplates(dir: string): void {
	templatesDir = dir;
	templates = [];
	const files = readdirSync(dir).filter(
		(f) => f.endsWith(".yml") || f.endsWith(".yaml"),
	);
	for (const file of files) {
		// Per file, and never fatal: `loadTemplates` runs before `serve()`, so a
		// single unparseable `.yml` used to mean the server never came up again —
		// and one can be dropped in from outside, or uploaded.
		try {
			const parsed: unknown = parse(readFileSync(join(dir, file), "utf-8"));
			const problems = validateTemplate(parsed);
			if (problems.length > 0) {
				logError(`Ignored ${file}`, problems.join("; "));
				continue;
			}
			const tpl = parsed as ServiceTemplate;
			templates.push(tpl);
			log(`Loaded service template: ${tpl.id}`);
		} catch (e) {
			logError(`Ignored ${file}`, e instanceof Error ? e.message : e);
		}
	}
}

export function reloadTemplates(): void {
	if (!templatesDir) return;
	loadTemplates(templatesDir);
}

export function getTemplatesDir(): string {
	return templatesDir;
}

export function getTemplateFiles(): string[] {
	if (!templatesDir) return [];
	return readdirSync(templatesDir).filter(
		(f) => f.endsWith(".yml") || f.endsWith(".yaml"),
	);
}

/** Every container this install declares — the hosts a template may name. */
export function containerNames(): string[] {
	return templates.map((t) => t.container);
}

export function getTemplates(): ServiceTemplate[] {
	return templates;
}

export function getTemplate(id: string): ServiceTemplate | undefined {
	return templates.find((t) => t.id === id);
}

export function getEnabledTemplates(db: Db): ServiceTemplate[] {
	return templates.filter((t) => db.get(`services.${t.id}.enabled`));
}

/** The DB defaults a template implies: its enable flag and each credential's default. */
export function getTemplateDefaults(): Record<string, unknown> {
	const defaults: Record<string, unknown> = {};
	for (const tpl of templates) {
		defaults[`services.${tpl.id}.enabled`] = tpl.defaultEnabled;
		for (const field of tpl.credentials ?? []) {
			defaults[`credentials.${tpl.id}.${field.key}`] = field.default ?? "";
		}
	}
	return defaults;
}

export function getServiceMetas(): ServiceMeta[] {
	return templates.map(
		({
			id,
			name,
			description,
			category,
			defaultEnabled,
			notes,
			requires,
			recommends,
			credentials,
		}) => ({
			id,
			name,
			description,
			category,
			defaultEnabled,
			notes: notes ?? [],
			requires: requires ?? [],
			recommends: recommends ?? [],
			// Like notes above: a service may ask the user for nothing, and the
			// wizard builds its default config by reading this without a guard.
			credentials: credentials ?? [],
		}),
	);
}

// ── Generated secrets ──

/**
 * Mints this template's declared secrets on first use and keeps them afterwards,
 * so an API key survives a reconfigure — and so a template can hand it to another
 * service through `{{internal.<id>.<key>}}` without any code knowing about either.
 */
export function ensureSecrets(db: Db, tpl: ServiceTemplate): void {
	for (const secret of tpl.generate ?? []) {
		const dbKey = `internal.${tpl.id}.${secret.key}`;
		if (db.get(dbKey)) continue;
		const value =
			secret.type === "uuid"
				? randomUUID()
				: randomBytes(secret.length ?? 32).toString("hex");
		db.set(dbKey, value);
		debug(`Generated ${dbKey}`);
	}
}

// ── Reconfigure surface ──

/**
 * Files a reconfigure regenerates: exactly what the templates declare writing.
 * Every template, not just the enabled ones — a service the user just turned off
 * must not leave a stale config behind for the day it is turned back on.
 */
export function getGeneratedConfigFiles(db: Db): string[] {
	return templates.flatMap((tpl) => getTemplateConfigFiles(db, tpl));
}

/** The same, for one template — what reconfiguring a single service must drop. */
export function getTemplateConfigFiles(db: Db, tpl: ServiceTemplate): string[] {
	const vars = buildVars(db, tpl.id);
	const files: string[] = [];
	for (const step of tpl.setup) {
		if (step.type !== "config_file" || !step.file) continue;
		files.push(resolveTemplateVars(step.file, vars) as string);
	}
	return files;
}

export function getResetDirs(): string[] {
	return templates.flatMap(getTemplateResetDirs);
}

export function getTemplateResetDirs(tpl: ServiceTemplate): string[] {
	return tpl.reset?.dirs ?? [];
}

// ── Setup step runner ──

/**
 * Polls until the service answers. With `match`, answering is not enough — the
 * body has to match too, which is how a template waits for a service to reach a
 * state instead of merely accepting connections.
 */
/**
 * How long one request may take. Without these the 120 s budget below is only
 * checked *between* attempts, so a peer that accepts a connection and then says
 * nothing holds the whole run until the socket gives up on its own.
 */
const PROBE_TIMEOUT_MS = 5000;
const CALL_TIMEOUT_MS = 30000;

/** A response body is only ever matched against a pattern this far in. */
const MAX_MATCH_BYTES = 64 * 1024;

async function waitForService(
	url: string,
	match?: string,
	maxWait = 120000,
): Promise<boolean> {
	const start = Date.now();
	const pattern = match ? new RegExp(match) : null;
	while (Date.now() - start < maxWait) {
		try {
			const res = await fetch(url, {
				signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
			});
			// Any HTTP response means the service is up (even 401/403)
			if (res.status > 0) {
				if (!pattern) return true;
				if (pattern.test((await res.text()).slice(0, MAX_MATCH_BYTES)))
					return true;
			}
		} catch {
			// connection refused = not ready yet
		}
		await new Promise((r) => setTimeout(r, 2000));
	}
	return false;
}

/**
 * The same headers with every secret blanked, for the debug log.
 *
 * By name rather than by an exact list: a template declares its own headers, so
 * the next service's way of spelling "api key" is not knowable here.
 */
function redactHeaders(
	headers: Record<string, string>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(headers).map(([k, v]) => [
			k,
			/key|token|auth|cookie|secret|password/i.test(k) ? "***" : v,
		]),
	);
}

/**
 * A peer's error body, shortened for a message the operator will read in the
 * wizard. It can be an entire HTML page, and it can carry back the very secret
 * the request sent.
 */
function errorDetail(
	method: string,
	url: string,
	status: number,
	body: string,
) {
	const bare = url.split("?")[0];
	const trimmed = body.trim().slice(0, 300);
	return `${method} ${bare} returned ${status}: ${trimmed}`;
}

/**
 * A step's declared headers, plus the stored cookie/token it opts into.
 *
 * `useCookie` and `useToken` say "send the session this service gave us", so
 * they are only honoured when the request is going back to that service. A
 * template naming a peer and asking for its neighbour's session would be
 * handing one service's credentials to another.
 */
function stepHeaders(
	step: SetupStepDef,
	db: Db,
	serviceId: string,
	vars: Record<string, string>,
	url: string,
): Record<string, string> {
	const headers: Record<string, string> = step.headers
		? Object.fromEntries(
				Object.entries(step.headers).map(([k, v]) => [
					k,
					resolveTemplateVars(v, vars) as string,
				]),
			)
		: {};
	const own = isOwnHost(url, getTemplate(serviceId)?.container ?? serviceId);
	if (step.useCookie && own) {
		const cookie = db.get(`internal.${serviceId}.cookie`) as string;
		if (cookie) headers.Cookie = cookie;
	}
	if (step.useToken && own) {
		// The presence check stays on the stored value: resolving an absent one
		// yields `Token=""`, which a service answers 401 to without saying why.
		// `buildVars` runs per step, so `{{internal.token}}` here is whatever the
		// login step stored a moment ago.
		const token = db.get(`internal.${serviceId}.token`) as string;
		if (token) {
			headers.Authorization = resolveTemplateVars(
				step.useToken,
				vars,
			) as string;
		}
	}
	return headers;
}

/**
 * A step that had nothing to do: its probe found the work already done, so
 * nothing was sent. Distinct from `null` on purpose — reporting a skip as a
 * success is what makes a stale peer invisible: the screen ticks "Connect
 * qBittorrent" green while no request ever left.
 */
export const SKIPPED = Symbol("skipped");

/**
 * The half of `store:` that reads an `api_call`'s answer — `from: body` walks a
 * dot path into the JSON, `from: cookie` takes the session header.
 *
 * A body is only read on a successful response: a 4xx error page is not the
 * document the path was written against, and storing whatever happens to sit at
 * that key would poison the slot for every later step.
 */
async function storeFromResponse(
	spec: StoreSpec | undefined,
	res: Response,
	db: Db,
	serviceId: string,
): Promise<void> {
	if (!spec) return;
	if (spec.from === "cookie") {
		const cookie = res.headers.get("set-cookie");
		if (cookie) db.set(`internal.${serviceId}.${spec.as}`, cookie);
		return;
	}
	if (spec.from !== "body" || !res.ok) return;
	try {
		let val: unknown = await res.clone().json();
		for (const key of (spec.path ?? "").split(".")) {
			val = (val as Record<string, unknown>)?.[key];
		}
		if (typeof val === "string") {
			db.set(`internal.${serviceId}.${spec.as}`, val);
			debug(`Stored ${spec.as} from ${spec.path}`);
		}
	} catch {
		debug(`Failed to read ${spec.path} from the response`);
	}
}

/** An error message, `SKIPPED`, or `null` when the step really ran. */
export type StepOutcome = string | typeof SKIPPED | null;

export async function runSetupStep(
	step: SetupStepDef,
	db: Db,
	serviceId: string,
	extraVars?: Record<string, string>,
): Promise<StepOutcome> {
	const vars = {
		...buildVars(db, serviceId),
		// A step configures one service to reach another, so the address it writes
		// is a container's view of a container — and a tunnelled service has no DNS
		// name of its own. Same resolution the compose block gets.
		...networkHosts(templates, resolveNetworkTopology(getEnabledTemplates(db))),
		...extraVars,
	};
	// Both URLs resolved through the allowlist, and a refusal is the step's
	// error rather than a throw: a template naming somewhere it has no business
	// reaching should say so on the screen the operator is watching.
	let url: string | undefined;
	let probe: string | undefined;
	try {
		url =
			serviceUrl(
				resolveTemplateVars(step.url ?? "", vars) as string,
				containerNames(),
			) || undefined;
		if (step.skipIf) {
			probe = serviceUrl(
				resolveTemplateVars(step.skipIf.url, vars) as string,
				containerNames(),
			);
		}
	} catch (e) {
		return e instanceof Error ? e.message : String(e);
	}

	if (probe && step.skipIf) {
		const pattern = resolveTemplateVars(step.skipIf.match, vars) as string;
		try {
			const res = await fetch(probe, {
				headers: stepHeaders(step, db, serviceId, vars, probe),
				signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
			});
			// A bounded prefix, not the whole body: the pattern is expanded from
			// template variables before it is compiled, so a credential can end up
			// being the regex, and a media server's response can be megabytes.
			const body = (await res.text()).slice(0, MAX_MATCH_BYTES);
			if (res.ok && new RegExp(pattern).test(body)) {
				debug(`Skipping ${step.name}: ${probe} already matches /${pattern}/`);
				return SKIPPED;
			}
		} catch {
			// Probe unreachable: run the step and let it report its own failure
		}
	}

	switch (step.type) {
		case "wait_ready": {
			if (!url) return "No URL configured";
			const ready = await waitForService(url, step.match);
			if (ready) return null;
			return step.match
				? `Timeout waiting for ${url} to match /${step.match}/`
				: `Timeout waiting for ${url}`;
		}

		case "api_call": {
			if (!url) return "No URL configured";
			const method = step.method ?? "POST";
			let resolved = step.body
				? resolveTemplateVars(step.body, vars)
				: undefined;

			// Change one field of a resource whose other fields are not ours to
			// know: read it, lay our keys over it, and send the whole thing back.
			if (step.merge && resolved) {
				try {
					const current = await fetch(url, {
						headers: stepHeaders(step, db, serviceId, vars, url),
						signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
					});
					if (!current.ok) {
						return `${url} returned ${current.status} while reading it to merge`;
					}
					resolved = {
						...((await current.json()) as Record<string, unknown>),
						...(resolved as Record<string, unknown>),
					};
				} catch (e) {
					return `Failed to read ${url} to merge: ${e instanceof Error ? e.message : e}`;
				}
			}
			const isForm = step.contentType === "form";
			let body: string | undefined;
			let contentType: string | undefined;
			if (resolved) {
				if (isForm) {
					const params = new URLSearchParams();
					for (const [k, v] of Object.entries(
						resolved as Record<string, string>,
					)) {
						params.set(k, String(v));
					}
					body = params.toString();
					contentType = "application/x-www-form-urlencoded";
				} else {
					body = JSON.stringify(resolved);
					contentType = "application/json";
				}
			}
			const retryOn = step.retryOn ?? [503];
			const maxRetries = step.maxRetries ?? 10;
			for (let attempt = 0; attempt <= maxRetries; attempt++) {
				try {
					const headers = stepHeaders(step, db, serviceId, vars, url);
					if (contentType) headers["Content-Type"] = contentType;
					debug(`${method} ${url}`, {
						headers: redactHeaders(headers),
						hasBody: !!body,
					});
					const res = await fetch(url, {
						method,
						headers,
						body,
						signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
					});
					await storeFromResponse(step.store, res, db, serviceId);
					if (res.ok || res.status === 204) return null;
					if (step.ignoreStatus?.includes(res.status)) return null;
					if (retryOn.includes(res.status) && attempt < maxRetries) {
						debug(
							`${url} returned ${res.status}, retrying (${attempt + 1}/${maxRetries})...`,
						);
						await new Promise((r) => setTimeout(r, 3000));
						continue;
					}
					const resBody = await res.text().catch(() => "");
					const detail = errorDetail(method, url, res.status, resBody);
					logError("API call failed", detail);
					return detail;
				} catch (e) {
					if (attempt < maxRetries) {
						debug(`${url} error, retrying (${attempt + 1}/${maxRetries})...`);
						await new Promise((r) => setTimeout(r, 3000));
						continue;
					}
					const msg = e instanceof Error ? e.message : String(e);
					logError(`API call error: ${url}`, msg);
					return `${method} ${url}: ${msg}`;
				}
			}
			return `${method} ${url}: max retries exceeded`;
		}

		case "config_file": {
			if (!step.file) return "config_file requires file";
			const configPath = db.get("paths.config") as string;
			if (!configPath) return "paths.config is not set";
			// After substitution, not before: `lib/template-schema.ts` refuses a
			// literal `..` in `file:`, but a `{{credentials.x}}` in it becomes a
			// path only here.
			let target: string;
			try {
				target = underRoot(
					configPath,
					resolveTemplateVars(step.file, vars) as string,
				);
			} catch {
				return `${step.file} is outside paths.config`;
			}
			if (step.skipIfExists !== false && existsSync(target)) {
				debug(`${step.file} already exists, skipping`);
				return SKIPPED;
			}
			try {
				mkdirSync(dirname(target), { recursive: true });
				writeFileSync(
					target,
					resolveTemplateVars(step.content ?? "", vars) as string,
				);
				debug(`Wrote ${step.file}`);
				return null;
			} catch (e) {
				return `Failed to write ${step.file}: ${e instanceof Error ? e.message : e}`;
			}
		}

		// The two sources that are not an API answer, and so are a step of their
		// own. They used to be two step types that differed only by where they
		// read — which is a parameter, not a kind of step.
		case "store": {
			const spec = step.store;
			if (!spec) return "store requires a store: block";

			if (spec.from === "logs") {
				if (!spec.container || !spec.regex) {
					return "store from logs requires container and regex";
				}
				try {
					// Both streams: an image may log its temporary password to either.
					const logs = runComposeSync(["logs", spec.container], {
						mergeStderr: true,
					});
					const match = logs.match(new RegExp(spec.regex));
					if (!match?.[1]) {
						return `Pattern not found in ${spec.container} logs: ${spec.regex}`;
					}
					db.set(`internal.${serviceId}.${spec.as}`, match[1]);
					debug(`Stored ${spec.as} from ${spec.container} logs`);
					return null;
				} catch (e) {
					return `Failed to read ${spec.container} logs: ${e instanceof Error ? e.message : e}`;
				}
			}

			if (spec.from === "file") {
				if (!spec.file || !spec.regex) {
					return "store from file requires file and regex";
				}
				const configPath = db.get("paths.config") as string;
				let filePath: string;
				try {
					filePath = underRoot(configPath, spec.file);
				} catch {
					return `${spec.file} is outside paths.config`;
				}
				// A service writes its config when it feels like it, so this waits
				// rather than failing on the first read.
				const maxAttempts = step.maxRetries ?? 15;
				for (let attempt = 0; attempt <= maxAttempts; attempt++) {
					try {
						const content = readFileSync(filePath, "utf-8");
						const match = content.match(new RegExp(spec.regex));
						if (match?.[1]) {
							db.set(`internal.${serviceId}.${spec.as}`, match[1]);
							debug(`Stored ${spec.as} from ${spec.file}`);
							return null;
						}
					} catch {
						// file not ready yet
					}
					if (attempt < maxAttempts) {
						debug(
							`Waiting for ${spec.file} (${attempt + 1}/${maxAttempts})...`,
						);
						await new Promise((r) => setTimeout(r, 3000));
					}
				}
				return `Pattern not found in ${spec.file} after ${maxAttempts} attempts`;
			}

			// `body` and `cookie` have no response to read outside an api_call.
			return `store from "${spec.from}" is not a step of its own — put it on an api_call`;
		}

		default:
			return `Unknown step type: ${step.type}`;
	}
}
