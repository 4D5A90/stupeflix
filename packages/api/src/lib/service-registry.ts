import { execSync } from "node:child_process";
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
import { compose } from "./docker-cli.js";
import { serviceUrl } from "./env.js";
import { debug, log, error as logError } from "./logger.js";
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

export interface SetupStepDef {
	name: string;
	label: string;
	type:
		| "config_file"
		| "api_call"
		| "wait_ready"
		| "extract_from_logs"
		| "extract_from_config";
	url?: string;
	method?: string;
	headers?: Record<string, string>;
	body?: unknown;
	contentType?: "json" | "form";
	storeCookie?: boolean;
	useCookie?: boolean;
	storeToken?: string;
	useToken?: boolean;
	foreach?: string;
	typeMap?: Record<string, Record<string, string>>;
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
	container?: string;
	/** Path under `paths.config`, for `config_file` and `extract_from_config`. */
	file?: string;
	/** File body for `config_file`. Template variables are resolved. */
	content?: string;
	/** `config_file` only: leave an existing file alone (default true). */
	skipIfExists?: boolean;
	regex?: string;
	storeAs?: string;
	/**
	 * `actions` only: which icon the dashboard draws on the button. Names are
	 * case-sensitive and listed in the README; an unknown one falls back to the
	 * default action icon rather than breaking the button.
	 */
	icon?: string;
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
	/** Compose services this template owns, verbatim, with template variables. */
	compose: Record<string, unknown>;
	generate?: SecretDef[];
	/** Directories under `paths.config` created before the container starts. */
	dirs?: string[];
	/** Directories under `paths.config` wiped on reconfigure, to replay a startup wizard. */
	reset?: { dirs?: string[] };
	credentials: CredentialField[];
	setup: SetupStepDef[];
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
		const raw = readFileSync(join(dir, file), "utf-8");
		const tpl = parse(raw) as ServiceTemplate;
		templates.push(tpl);
		log(`Loaded service template: ${tpl.id}`);
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
			credentials,
		}) => ({
			id,
			name,
			description,
			category,
			defaultEnabled,
			notes: notes ?? [],
			credentials,
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
async function waitForService(
	url: string,
	match?: string,
	maxWait = 120000,
): Promise<boolean> {
	const start = Date.now();
	const pattern = match ? new RegExp(match) : null;
	while (Date.now() - start < maxWait) {
		try {
			const res = await fetch(url);
			// Any HTTP response means the service is up (even 401/403)
			if (res.status > 0) {
				if (!pattern) return true;
				if (pattern.test(await res.text())) return true;
			}
		} catch {
			// connection refused = not ready yet
		}
		await new Promise((r) => setTimeout(r, 2000));
	}
	return false;
}

/** A step's declared headers, plus the stored cookie/token it opts into. */
function stepHeaders(
	step: SetupStepDef,
	db: Db,
	serviceId: string,
	vars: Record<string, string>,
): Record<string, string> {
	const headers: Record<string, string> = step.headers
		? Object.fromEntries(
				Object.entries(step.headers).map(([k, v]) => [
					k,
					resolveTemplateVars(v, vars) as string,
				]),
			)
		: {};
	if (step.useCookie) {
		const cookie = db.get(`internal.${serviceId}.cookie`) as string;
		if (cookie) headers.Cookie = cookie;
	}
	if (step.useToken) {
		const token = db.get(`internal.${serviceId}.token`) as string;
		if (token) headers.Authorization = `MediaBrowser Token="${token}"`;
	}
	return headers;
}

export async function runSetupStep(
	step: SetupStepDef,
	db: Db,
	serviceId: string,
	extraVars?: Record<string, string>,
): Promise<string | null> {
	const vars = { ...buildVars(db, serviceId), ...extraVars };
	const url =
		serviceUrl(resolveTemplateVars(step.url ?? "", vars) as string) ||
		undefined;

	if (step.skipIf) {
		const probe = serviceUrl(
			resolveTemplateVars(step.skipIf.url, vars) as string,
		);
		const pattern = resolveTemplateVars(step.skipIf.match, vars) as string;
		try {
			const res = await fetch(probe, {
				headers: stepHeaders(step, db, serviceId, vars),
			});
			if (res.ok && new RegExp(pattern).test(await res.text())) {
				debug(`Skipping ${step.name}: ${probe} already matches /${pattern}/`);
				return null;
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
			const resolved = step.body
				? resolveTemplateVars(step.body, vars)
				: undefined;
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
					const headers = stepHeaders(step, db, serviceId, vars);
					if (contentType) headers["Content-Type"] = contentType;
					debug(`${method} ${url}`, { headers, hasBody: !!body });
					const res = await fetch(url, { method, headers, body });
					if (step.storeCookie) {
						const cookie = res.headers.get("set-cookie");
						if (cookie) db.set(`internal.${serviceId}.cookie`, cookie);
					}
					if (step.storeToken && res.ok) {
						try {
							const json = await res.clone().json();
							const tokenPath = step.storeToken.split(".");
							let val: unknown = json;
							for (const key of tokenPath) {
								val = (val as Record<string, unknown>)?.[key];
							}
							if (typeof val === "string") {
								db.set(`internal.${serviceId}.token`, val);
								debug(`Stored token from ${step.storeToken}`);
							}
						} catch {
							debug("Failed to extract token from response");
						}
					}
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
					const detail = `${method} ${url} returned ${res.status}: ${resBody}`;
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
			const target = join(
				configPath,
				resolveTemplateVars(step.file, vars) as string,
			);
			if (step.skipIfExists !== false && existsSync(target)) {
				debug(`${step.file} already exists, skipping`);
				return null;
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

		case "extract_from_logs": {
			if (!step.container || !step.regex || !step.storeAs) {
				return "extract_from_logs requires container, regex, and storeAs";
			}
			try {
				const logs = execSync(compose(`logs ${step.container} 2>&1`), {
					encoding: "utf-8",
				});
				const match = logs.match(new RegExp(step.regex));
				if (!match?.[1]) {
					return `Pattern not found in ${step.container} logs: ${step.regex}`;
				}
				db.set(`internal.${serviceId}.${step.storeAs}`, match[1]);
				debug(`Extracted ${step.storeAs} from ${step.container} logs`);
				return null;
			} catch (e) {
				return `Failed to read ${step.container} logs: ${e instanceof Error ? e.message : e}`;
			}
		}

		case "extract_from_config": {
			if (!step.file || !step.regex || !step.storeAs) {
				return "extract_from_config requires file, regex, and storeAs";
			}
			const configPath = db.get("paths.config") as string;
			const filePath = join(configPath, step.file);
			const maxAttempts = step.maxRetries ?? 15;
			for (let attempt = 0; attempt <= maxAttempts; attempt++) {
				try {
					const content = readFileSync(filePath, "utf-8");
					const match = content.match(new RegExp(step.regex));
					if (match?.[1]) {
						db.set(`internal.${serviceId}.${step.storeAs}`, match[1]);
						debug(`Extracted ${step.storeAs} from ${step.file}`);
						return null;
					}
				} catch {
					// file not ready yet
				}
				if (attempt < maxAttempts) {
					debug(`Waiting for ${step.file} (${attempt + 1}/${maxAttempts})...`);
					await new Promise((r) => setTimeout(r, 3000));
				}
			}
			return `Pattern not found in ${step.file} after ${maxAttempts} attempts`;
		}

		default:
			return `Unknown step type: ${step.type}`;
	}
}
