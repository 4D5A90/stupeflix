import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { COMPOSE_FILE, COMPOSE_PROJECT } from "./env.js";

const execFileAsync = promisify(execFile);

/**
 * Container logs and a full `ps` outgrow the 1 MB Node gives a child by default,
 * and the failure reads as "command failed" rather than as "output truncated".
 */
const MAX_BUFFER = 16 * 1024 * 1024;

/**
 * Only for the reads. `up`, `down` and `pull` are deliberately left unbounded:
 * a first install pulls a dozen images, and a timeout there would kill a run
 * that was working.
 */
const READ_TIMEOUT_MS = 60000;

interface RunOptions {
	/** Fold stderr into the returned text — a container logs to both streams. */
	mergeStderr?: boolean;
	/** Let the child write to this process's console, for compose's progress. */
	inherit?: boolean;
}

/**
 * `docker compose` pinned to the generated file and the project name, so it
 * behaves the same whatever the working directory is.
 *
 * An array rather than a string, and every runner below goes through
 * `execFile`: **no shell is involved anywhere in this module**. That is the
 * point of it. A container name, a `--tail` value or a project name cannot end
 * the command and start another one, whatever they contain — which is not a
 * property you can get by escaping call site by call site.
 */
export function composeArgs(args: string[]): string[] {
	const project = COMPOSE_PROJECT ? ["-p", COMPOSE_PROJECT] : [];
	return ["compose", ...project, "-f", COMPOSE_FILE, ...args];
}

export function runDockerSync(
	args: string[],
	{ mergeStderr = false, inherit = false }: RunOptions = {},
): string {
	const res = spawnSync("docker", args, {
		encoding: "utf-8",
		maxBuffer: MAX_BUFFER,
		timeout: READ_TIMEOUT_MS,
		// stderr captured rather than forwarded: `docker inspect` on a container
		// that does not exist is an expected answer here, not something to print.
		stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
	});
	if (res.error) throw res.error;
	if (res.status !== 0) {
		const detail = (res.stderr ?? "").trim().slice(0, 500);
		throw new Error(`docker ${args[0]} exited with ${res.status}: ${detail}`);
	}
	return mergeStderr
		? `${res.stdout ?? ""}${res.stderr ?? ""}`
		: (res.stdout ?? "");
}

export function runComposeSync(args: string[], options?: RunOptions): string {
	return runDockerSync(composeArgs(args), options);
}

export function runDocker(
	args: string[],
): Promise<{ stdout: string; stderr: string }> {
	return execFileAsync("docker", args, { maxBuffer: MAX_BUFFER });
}

export function runCompose(
	args: string[],
): Promise<{ stdout: string; stderr: string }> {
	return runDocker(composeArgs(args));
}
