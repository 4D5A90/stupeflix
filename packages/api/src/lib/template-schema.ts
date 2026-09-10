import type { ServiceTemplate, SetupStepDef } from "./service-registry.js";

/**
 * What a `.yml` has to be before the engine will treat it as a template.
 *
 * A template is root-equivalent code: its `compose:` block is merged verbatim
 * into the file `docker compose up` then executes, and its `setup:` steps write
 * files, read files and call hosts. `loadTemplates` used to cast the parsed YAML
 * with `as ServiceTemplate` and hope — so an empty file stopped the server from
 * booting, and a hostile one could ask for `privileged: true`.
 *
 * This is the gate. It runs at load, on shipped and uploaded files alike, and it
 * answers with the list of reasons rather than a boolean: a template refused
 * without a reason is a template nobody can fix. **It never throws** — the
 * upload route turns its answer into a 400, and an exception there would be a
 * 500 that says nothing.
 *
 * It is deliberately about *safety and shape*, not about correctness —
 * `templates.test.ts` is what proves every `{{...}}` resolves and every category
 * exists, and it runs where a human can read the failure. That suite is also
 * stricter where it can afford to be: it holds shipped ids to `^[a-z0-9-]+$`,
 * while this file has to accept anything an operator may legitimately upload.
 */

/** Fails to compile when a list below stops covering the type it mirrors. */
function assertCovered<_Missing extends never>(): void {}

const TEMPLATE_KEY_LIST = [
	"id",
	"name",
	"description",
	"category",
	"defaultEnabled",
	"container",
	"port",
	"webUiPath",
	"notes",
	"requires",
	"recommends",
	"compose",
	"volumes",
	"generate",
	"dirs",
	"reset",
	"credentials",
	"setup",
	"actions",
	"network",
	"info",
] as const satisfies readonly (keyof ServiceTemplate)[];
assertCovered<
	Exclude<keyof ServiceTemplate, (typeof TEMPLATE_KEY_LIST)[number]>
>();
const TEMPLATE_KEYS = new Set<string>(TEMPLATE_KEY_LIST);

const STEP_KEY_LIST = [
	"name",
	"label",
	"type",
	"if",
	"url",
	"method",
	"headers",
	"body",
	"contentType",
	"storeCookie",
	"useCookie",
	"storeToken",
	"useToken",
	"foreach",
	"retryOn",
	"maxRetries",
	"ignoreStatus",
	"match",
	"skipIf",
	"merge",
	"container",
	"file",
	"content",
	"skipIfExists",
	"regex",
	"storeAs",
	"icon",
] as const satisfies readonly (keyof SetupStepDef)[];
assertCovered<Exclude<keyof SetupStepDef, (typeof STEP_KEY_LIST)[number]>>();
const STEP_KEYS = new Set<string>(STEP_KEY_LIST);

const STEP_TYPE_LIST = [
	"config_file",
	"api_call",
	"wait_ready",
	"extract_from_logs",
	"extract_from_config",
] as const satisfies readonly SetupStepDef["type"][];
assertCovered<Exclude<SetupStepDef["type"], (typeof STEP_TYPE_LIST)[number]>>();
const STEP_TYPES = new Set<string>(STEP_TYPE_LIST);

/**
 * Ids, container names, and a step's `container:`.
 *
 * No dot, and that is the point rather than tidiness: `containerNames()` feeds
 * the allowlist in `lib/service-url.ts`, so a template calling itself
 * `169.254.169.254` or `metadata.example.com` would name a host the engine then
 * agrees to fetch — reopening the very hole that allowlist exists to close.
 */
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Regexes from a template are compiled with `new RegExp` and run against a
 * service's output. A pattern nobody can read is a pattern nobody can review,
 * and a long one is how catastrophic backtracking is written.
 */
const MAX_PATTERN = 200;

/**
 * Compose keys that hand a container the host it runs on. Refused outright —
 * none of the shipped templates declares one, and a service that needs one is a
 * change to this list, made by someone who read it.
 *
 * `network_mode` is on the list for a second reason: `lib/network.ts` sets it
 * when a service joins a tunnel, and a template setting it too would be
 * silently overwritten or silently win.
 */
const FORBIDDEN_COMPOSE_KEYS = [
	"privileged",
	"pid",
	"ipc",
	"uts",
	"userns_mode",
	"security_opt",
	"cgroup_parent",
	"sysctls",
	"network_mode",
];

/**
 * `cap_add` and `devices` are not refused, they are bounded: gluetun genuinely
 * needs `NET_ADMIN` and `/dev/net/tun` to raise a WireGuard interface, and a
 * media server genuinely needs `/dev/dri` to transcode on the GPU. `SYS_ADMIN`
 * or `/dev/sda` are a different request entirely.
 */
const ALLOWED_CAPS = new Set(["NET_ADMIN"]);
const ALLOWED_DEVICES = new Set(["/dev/net/tun", "/dev/dri"]);

/**
 * Where a bind mount may start. The engine resolves these three to whatever the
 * wizard was given, and `lib/safe-path.ts` keeps that inside the host root — so
 * a mount anchored here cannot reach `/`, and one anchored anywhere else can.
 */
const MOUNT_ROOTS = [
	"{{paths.config}}",
	"{{paths.media}}",
	"{{paths.torrents}}",
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether any segment of this path steps back up a level. */
function climbs(path: string): boolean {
	return path.split(/[\\/]/).includes("..");
}

/** A path a template may hand to `join()`: relative, and staying that way. */
function relativePathProblem(label: string, value: unknown): string | null {
	if (typeof value !== "string" || value === "") {
		return `${label} must be a non-empty string`;
	}
	if (value.startsWith("/")) return `${label} must be relative, got "${value}"`;
	if (climbs(value)) {
		return `${label} must not climb out with "..", got "${value}"`;
	}
	return null;
}

function patternProblem(label: string, value: unknown): string | null {
	if (value === undefined) return null;
	if (typeof value !== "string") return `${label} must be a string`;
	if (value.length > MAX_PATTERN) {
		return `${label} is longer than ${MAX_PATTERN} characters`;
	}
	return null;
}

/** The source half of a `volumes:` entry, in either syntax. */
function mountSource(entry: unknown): string | null {
	if (typeof entry === "string") return entry.split(":")[0];
	if (isRecord(entry) && entry.type === "bind") {
		return typeof entry.source === "string" ? entry.source : "";
	}
	// A long-syntax named volume, or a tmpfs: neither names a host path.
	return null;
}

function mountProblem(
	where: string,
	entry: unknown,
	declaredVolumes: Set<string>,
): string | null {
	const source = mountSource(entry);
	if (source === null) return null;
	const root = MOUNT_ROOTS.find((r) => source.startsWith(r));
	if (root) {
		// A prefix is not containment. `{{paths.media}}/../../var/run/docker.sock`
		// starts with a root and resolves nowhere near it — and compose passes the
		// string through untouched, so the daemon is what resolves it.
		return climbs(source.slice(root.length))
			? `${where}: "${source}" climbs back out of ${root}`
			: null;
	}
	// Not a host path at all: a named volume, which Docker owns and which has to
	// be declared so `generateCompose` emits it.
	if (!source.includes("/") && declaredVolumes.has(source)) return null;
	return `${where}: "${source}" is neither a declared volume nor under {{paths.*}}`;
}

function composeProblems(
	compose: Record<string, unknown>,
	declaredVolumes: Set<string>,
): string[] {
	const problems: string[] = [];
	for (const [name, service] of Object.entries(compose)) {
		if (!isRecord(service)) {
			problems.push(`compose.${name} must be a mapping`);
			continue;
		}
		for (const key of FORBIDDEN_COMPOSE_KEYS) {
			if (key in service) {
				problems.push(`compose.${name}.${key} is not allowed`);
			}
		}
		for (const [key, allowed] of [
			["cap_add", ALLOWED_CAPS],
			["devices", ALLOWED_DEVICES],
		] as const) {
			const declared = service[key];
			if (declared === undefined) continue;
			if (!Array.isArray(declared)) {
				problems.push(`compose.${name}.${key} must be a list`);
				continue;
			}
			for (const value of declared) {
				if (!allowed.has(String(value).split(":")[0])) {
					problems.push(`compose.${name}.${key}: ${value} is not allowed`);
				}
			}
		}
		if (service.volumes !== undefined) {
			if (!Array.isArray(service.volumes)) {
				problems.push(`compose.${name}.volumes must be a list`);
			} else {
				for (const entry of service.volumes) {
					const problem = mountProblem(
						`compose.${name}.volumes`,
						entry,
						declaredVolumes,
					);
					if (problem) problems.push(problem);
				}
			}
		}
	}
	return problems;
}

function stepProblems(where: string, step: unknown): string[] {
	if (!isRecord(step)) return [`${where} must be a mapping`];
	const problems: string[] = [];
	for (const key of Object.keys(step)) {
		if (!STEP_KEYS.has(key)) {
			problems.push(`${where}.${key} is not a step field`);
		}
	}
	if (typeof step.name !== "string" || step.name === "") {
		problems.push(`${where}.name is required`);
	}
	if (typeof step.label !== "string" || step.label === "") {
		problems.push(`${where}.label is required`);
	}
	if (!STEP_TYPES.has(String(step.type))) {
		problems.push(`${where}.type "${step.type}" is not a step type`);
	}
	if (step.file !== undefined) {
		const problem = relativePathProblem(`${where}.file`, step.file);
		if (problem) problems.push(problem);
	}
	if (step.container !== undefined && !NAME.test(String(step.container))) {
		problems.push(
			`${where}.container "${step.container}" is not a container name`,
		);
	}
	for (const [key, value] of [
		["regex", step.regex],
		["match", step.match],
	] as const) {
		const problem = patternProblem(`${where}.${key}`, value);
		if (problem) problems.push(problem);
	}
	if (step.skipIf !== undefined) {
		if (!isRecord(step.skipIf)) {
			problems.push(`${where}.skipIf must be a mapping`);
		} else {
			const problem = patternProblem(
				`${where}.skipIf.match`,
				step.skipIf.match,
			);
			if (problem) problems.push(problem);
		}
	}
	return problems;
}

/** A list whose entries all satisfy `check`, or the reasons they do not. */
function listProblems(
	label: string,
	value: unknown,
	check: (entry: unknown, where: string) => string | null,
): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) return [`${label} must be a list`];
	return value.flatMap((entry, i) => {
		const problem = check(entry, `${label}[${i}]`);
		return problem ? [problem] : [];
	});
}

const mustBeRecord = (entry: unknown, where: string) =>
	isRecord(entry) ? null : `${where} must be a mapping`;

const mustBeString = (entry: unknown, where: string) =>
	typeof entry === "string" ? null : `${where} must be text`;

/** Every reason this value cannot be a template. Empty means it can. */
export function validateTemplate(value: unknown): string[] {
	if (!isRecord(value)) return ["not a mapping"];
	const problems: string[] = [];

	for (const key of Object.keys(value)) {
		if (!TEMPLATE_KEYS.has(key)) {
			problems.push(`${key} is not a template field`);
		}
	}

	for (const key of ["name", "description", "category"] as const) {
		if (typeof value[key] !== "string" || value[key] === "") {
			problems.push(`${key} is required`);
		}
	}
	for (const key of ["id", "container"] as const) {
		if (typeof value[key] !== "string" || !NAME.test(value[key] as string)) {
			problems.push(`${key} must match ${NAME.source}`);
		}
	}
	if (typeof value.defaultEnabled !== "boolean") {
		problems.push("defaultEnabled must be true or false");
	}
	if (value.port !== undefined && !Number.isInteger(value.port)) {
		problems.push("port must be a whole number");
	}
	if (value.webUiPath !== undefined && typeof value.webUiPath !== "string") {
		problems.push("webUiPath must be text");
	}

	if (!isRecord(value.compose)) {
		problems.push("compose must be a mapping of compose services");
	}
	if (value.volumes !== undefined && !isRecord(value.volumes)) {
		problems.push("volumes must be a mapping");
	}
	if (value.network !== undefined && !isRecord(value.network)) {
		problems.push("network must be a mapping");
	}
	if (value.reset !== undefined && !isRecord(value.reset)) {
		problems.push("reset must be a mapping");
	}
	if (!Array.isArray(value.setup)) {
		problems.push("setup must be a list, even an empty one");
	}

	/*
	 * Every list field, and none of them is read defensively downstream:
	 * `services.ts` maps over `info` and `notes`, `requirements.ts` walks
	 * `requires`, `service-registry.ts` walks `generate`. A template that loads
	 * with a string where a list belongs takes out the dashboard, not itself.
	 */
	problems.push(...listProblems("notes", value.notes, mustBeString));
	problems.push(...listProblems("requires", value.requires, mustBeRecord));
	problems.push(...listProblems("recommends", value.recommends, mustBeRecord));
	problems.push(...listProblems("generate", value.generate, mustBeRecord));
	problems.push(...listProblems("info", value.info, mustBeRecord));
	problems.push(
		...listProblems("credentials", value.credentials, mustBeRecord),
	);

	// Both feed `join(paths.config, …)` — `dirs` a mkdir, `reset.dirs` a
	// recursive delete. The second is the sharpest edge in the whole engine.
	problems.push(
		...listProblems("dirs", value.dirs, (entry, where) =>
			relativePathProblem(where, entry),
		),
	);
	if (isRecord(value.reset)) {
		problems.push(
			...listProblems("reset.dirs", value.reset.dirs, (entry, where) =>
				relativePathProblem(where, entry),
			),
		);
	}

	// Compiled and run by `lib/credential-rules.ts` on every credential write,
	// which is what makes an over-long one worth refusing here.
	if (Array.isArray(value.credentials)) {
		value.credentials.forEach((field, i) => {
			if (!isRecord(field)) return; // already reported by listProblems
			const rules = isRecord(field.rules) ? field.rules : {};
			const problem = patternProblem(
				`credentials[${i}].rules.pattern`,
				rules.pattern,
			);
			if (problem) problems.push(problem);
		});
	}

	if (Array.isArray(value.setup)) {
		value.setup.forEach((step, i) => {
			problems.push(...stepProblems(`setup[${i}]`, step));
		});
	}
	if (value.actions !== undefined) {
		if (!isRecord(value.actions)) {
			problems.push("actions must be a mapping");
		} else {
			for (const [name, step] of Object.entries(value.actions)) {
				problems.push(...stepProblems(`actions.${name}`, step));
			}
		}
	}

	if (isRecord(value.compose)) {
		const declared = new Set(
			isRecord(value.volumes) ? Object.keys(value.volumes) : [],
		);
		problems.push(...composeProblems(value.compose, declared));
	}

	return problems;
}
