import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { Db } from "../db.js";
import { log, debug, error as logError } from "./logger.js";

// ── YAML schema types ──

export interface FieldRules {
	minLength?: number;
	maxLength?: number;
	pattern?: string;
	message?: string;
}

export interface CredentialField {
	key: string;
	type: "text" | "password" | "email";
	label: string;
	default?: string;
	rules?: FieldRules;
}

export interface SetupStepDef {
	name: string;
	label: string;
	type: "config_file" | "api_call" | "wait_ready" | "extract_from_logs";
	url?: string;
	method?: string;
	headers?: Record<string, string>;
	body?: unknown;
	contentType?: "json" | "form";
	storeCookie?: boolean;
	useCookie?: boolean;
	storeToken?: string;
	useToken?: boolean;
	retryOn?: number[];
	maxRetries?: number;
	ignoreStatus?: number[];
	container?: string;
	regex?: string;
	storeAs?: string;
}

export interface ServiceTemplate {
	id: string;
	name: string;
	description: string;
	category: string;
	defaultEnabled: boolean;
	container: string;
	port: number;
	credentials: CredentialField[];
	setup: SetupStepDef[];
}

// ── Public API sent to frontend ──

export interface ServiceMeta {
	id: string;
	name: string;
	description: string;
	category: string;
	defaultEnabled: boolean;
	credentials: CredentialField[];
}

// ── Loader ──

let templates: ServiceTemplate[] = [];
let templatesDir = "";

export function loadTemplates(dir: string): void {
	templatesDir = dir;
	templates = [];
	const files = readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
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
	return readdirSync(templatesDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
}

export function getTemplates(): ServiceTemplate[] {
	return templates;
}

export function getTemplate(id: string): ServiceTemplate | undefined {
	return templates.find((t) => t.id === id);
}

export function getServiceMetas(): ServiceMeta[] {
	return templates.map(({ id, name, description, category, defaultEnabled, credentials }) => ({
		id,
		name,
		description,
		category,
		defaultEnabled,
		credentials,
	}));
}

// ── Setup step runner ──

function resolveTemplateVars(
	value: unknown,
	vars: Record<string, string>,
): unknown {
	if (typeof value === "string") {
		return value.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, key: string) => vars[key] ?? "");
	}
	if (Array.isArray(value)) {
		return value.map((v) => resolveTemplateVars(v, vars));
	}
	if (value !== null && typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			result[k] = resolveTemplateVars(v, vars);
		}
		return result;
	}
	return value;
}

function buildVars(db: Db, serviceId: string): Record<string, string> {
	const vars: Record<string, string> = {};
	const all = db.all();
	const credPrefix = `credentials.${serviceId}.`;
	const intPrefix = `internal.${serviceId}.`;
	for (const [key, value] of Object.entries(all)) {
		if (typeof value !== "string") continue;
		if (key.startsWith(credPrefix)) {
			vars[`credentials.${key.slice(credPrefix.length)}`] = value;
		} else if (key.startsWith(intPrefix)) {
			vars[`internal.${key.slice(intPrefix.length)}`] = value;
		}
	}
	return vars;
}

async function waitForService(url: string, maxWait = 120000): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < maxWait) {
		try {
			const res = await fetch(url);
			// Any HTTP response means the service is up (even 401/403)
			if (res.status > 0) return true;
		} catch {
			// connection refused = not ready yet
		}
		await new Promise((r) => setTimeout(r, 2000));
	}
	return false;
}

export async function runSetupStep(
	step: SetupStepDef,
	db: Db,
	serviceId: string,
): Promise<string | null> {
	const vars = buildVars(db, serviceId);
	// Force IPv4 — containers listen on 0.0.0.0, but localhost may resolve to ::1
	const url = step.url?.replace("://localhost", "://127.0.0.1");

	switch (step.type) {
		case "wait_ready": {
			if (!url) return "No URL configured";
			const ready = await waitForService(url);
			return ready ? null : `Timeout waiting for ${url}`;
		}

		case "api_call": {
			if (!url) return "No URL configured";
			const method = step.method ?? "POST";
			const resolved = step.body ? resolveTemplateVars(step.body, vars) : undefined;
			const isForm = step.contentType === "form";
			let body: string | undefined;
			let contentType: string | undefined;
			if (resolved) {
				if (isForm) {
					const params = new URLSearchParams();
					for (const [k, v] of Object.entries(resolved as Record<string, string>)) {
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
					const headers: Record<string, string> = { ...step.headers };
					if (contentType) headers["Content-Type"] = contentType;
					if (step.useCookie) {
						const cookie = db.get(`internal.${serviceId}.cookie`) as string;
						if (cookie) headers.Cookie = cookie;
					}
					if (step.useToken) {
						const token = db.get(`internal.${serviceId}.token`) as string;
						if (token) headers.Authorization = `MediaBrowser Token="${token}"`;
					}
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
						debug(`${url} returned ${res.status}, retrying (${attempt + 1}/${maxRetries})...`);
						await new Promise((r) => setTimeout(r, 3000));
						continue;
					}
					const resBody = await res.text().catch(() => "");
					const detail = `${method} ${url} returned ${res.status}: ${resBody}`;
					logError(`API call failed`, detail);
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
			return null;
		}

		case "extract_from_logs": {
			if (!step.container || !step.regex || !step.storeAs) {
				return "extract_from_logs requires container, regex, and storeAs";
			}
			try {
				const logs = execSync(
					`docker compose logs ${step.container} 2>&1`,
					{ encoding: "utf-8" },
				);
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

		default:
			return `Unknown step type: ${step.type}`;
	}
}
