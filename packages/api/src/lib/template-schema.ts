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
 * without a reason is a template nobody can fix.
 *
 * It is deliberately about *safety and shape*, not about correctness —
 * `templates.test.ts` is what proves every `{{...}}` resolves and every category
 * exists, and it runs where a human can read the failure.
 */

/** Every key `ServiceTemplate` declares. Anything else is a typo or a payload. */
const TEMPLATE_KEYS = new Set([
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
]);

/** Every key `SetupStepDef` declares. */
const STEP_KEYS = new Set([
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
]);

const STEP_TYPES = new Set([
	"config_file",
	"api_call",
	"wait_ready",
	"extract_from_logs",
	"extract_from_config",
]);

/** Ids and container names reach a DB key and a command line. */
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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

/** A path a template may hand to `join()`: relative, and staying that way. */
function pathProblem(label: string, value: unknown): string | null {
	if (typeof value !== "string" || value === "") {
		return `${label} must be a non-empty string`;
	}
	if (value.startsWith("/")) return `${label} must be relative, got "${value}"`;
	if (value.split(/[\\/]/).includes("..")) {
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
	if (isRecord(entry) && entry.type === "bind")
		return String(entry.source ?? "");
	// A long-syntax volume or tmpfs names no host path.
	return null;
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
			if (key in service)
				problems.push(`compose.${name}.${key} is not allowed`);
		}
		for (const cap of (service.cap_add as unknown[]) ?? []) {
			if (!ALLOWED_CAPS.has(String(cap))) {
				problems.push(`compose.${name}.cap_add: ${cap} is not allowed`);
			}
		}
		for (const device of (service.devices as unknown[]) ?? []) {
			if (!ALLOWED_DEVICES.has(String(device).split(":")[0])) {
				problems.push(`compose.${name}.devices: ${device} is not allowed`);
			}
		}
		for (const entry of (service.volumes as unknown[]) ?? []) {
			const source = mountSource(entry);
			if (source === null) continue;
			if (MOUNT_ROOTS.some((root) => source.startsWith(root))) continue;
			// Not a host path at all: a named volume, which Docker owns and which
			// has to be declared so `generateCompose` emits it.
			if (!source.includes("/") && declaredVolumes.has(source)) continue;
			problems.push(
				`compose.${name}.volumes: "${source}" is neither a declared volume nor under {{paths.*}}`,
			);
		}
	}
	return problems;
}

function stepProblems(where: string, step: unknown): string[] {
	if (!isRecord(step)) return [`${where} must be a mapping`];
	const problems: string[] = [];
	for (const key of Object.keys(step)) {
		if (!STEP_KEYS.has(key))
			problems.push(`${where}.${key} is not a step field`);
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
		const problem = pathProblem(`${where}.file`, step.file);
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

function listProblems(
	label: string,
	value: unknown,
	check: (v: unknown) => string | null,
): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) return [`${label} must be a list`];
	return value.flatMap((entry, i) => {
		const problem = check(entry);
		return problem ? [`${label}[${i}]: ${problem}`] : [];
	});
}

/** Every reason this value cannot be a template. Empty means it can. */
export function validateTemplate(value: unknown): string[] {
	if (!isRecord(value)) return ["not a mapping"];
	const problems: string[] = [];

	for (const key of Object.keys(value)) {
		if (!TEMPLATE_KEYS.has(key))
			problems.push(`${key} is not a template field`);
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

	if (!isRecord(value.compose)) {
		problems.push("compose must be a mapping of compose services");
	}
	if (value.volumes !== undefined && !isRecord(value.volumes)) {
		problems.push("volumes must be a mapping");
	}
	if (!Array.isArray(value.setup)) {
		problems.push("setup must be a list, even an empty one");
	}

	// Both feed `join(paths.config, …)` — `dirs` a mkdir, `reset.dirs` a
	// recursive delete. The second is the sharpest edge in the whole engine.
	problems.push(
		...listProblems("dirs", value.dirs, (v) => pathProblem("entry", v)),
	);
	if (value.reset !== undefined) {
		if (!isRecord(value.reset)) {
			problems.push("reset must be a mapping");
		} else {
			problems.push(
				...listProblems("reset.dirs", value.reset.dirs, (v) =>
					pathProblem("entry", v),
				),
			);
		}
	}

	// Compiled and run by `lib/credential-rules.ts` on every credential write,
	// which is what makes an over-long one worth refusing here.
	if (Array.isArray(value.credentials)) {
		value.credentials.forEach((field, i) => {
			if (!isRecord(field)) {
				problems.push(`credentials[${i}] must be a mapping`);
				return;
			}
			const rules = isRecord(field.rules) ? field.rules : {};
			const problem = patternProblem(
				`credentials[${i}].rules.pattern`,
				rules.pattern,
			);
			if (problem) problems.push(problem);
		});
	} else if (value.credentials !== undefined) {
		problems.push("credentials must be a list");
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
