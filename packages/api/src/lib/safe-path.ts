import { isAbsolute, resolve, sep } from "node:path";
import { ROOT } from "./env.js";

/**
 * `join`, plus the proof that the result did not climb out of `base`.
 *
 * Every path this API touches is built the same way — a root from the database,
 * a tail from a template or from the wizard — and `join` alone happily walks out
 * of the root with `..`. The tails are checked where they are written too
 * (`lib/template-schema.ts` for a template, `pathProblem` below for the wizard),
 * but neither check sees the *expanded* value: `file: "{{credentials.x}}/conf"`
 * becomes a path only here.
 */
export function underRoot(base: string, ...segments: string[]): string {
	const root = resolve(base);
	const target = resolve(root, ...segments);
	if (target !== root && !target.startsWith(root + sep)) {
		throw new Error(`${target} is outside ${root}`);
	}
	return target;
}

export function isUnderRoot(base: string, candidate: string): boolean {
	try {
		underRoot(base, candidate);
		return true;
	} catch {
		return false;
	}
}

/**
 * Why this cannot be one of the wizard's three paths, or null.
 *
 * These are not ordinary settings: they are the base of every `join()` above,
 * and the source of every bind mount in the generated compose file. Pointed at
 * `/etc`, the next reconfigure empties it — `dropConfig` deletes recursively.
 */
export function pathProblem(value: unknown): string | null {
	if (typeof value !== "string" || value.trim() === "") {
		return "must not be empty";
	}
	if (!isAbsolute(value)) return "must be an absolute path";
	if (value.split(/[\\/]/).includes("..")) return 'must not contain ".."';
	if (resolve(value) === resolve(sep)) {
		return "must not be the filesystem root";
	}
	// Only when a host root is mounted. Running from source there is no such
	// boundary to enforce, and inventing one would break `pnpm dev`.
	if (ROOT && !isUnderRoot(ROOT, value)) return `must be under ${ROOT}`;
	return null;
}

/**
 * Why this cannot be a library name, or null. It becomes a directory under
 * `paths.media` and a `{{library.name}}` in setup steps.
 */
export function libraryNameProblem(value: unknown): string | null {
	if (typeof value !== "string" || value.trim() === "") {
		return "must not be empty";
	}
	if (/[\\/]/.test(value)) return "must not contain a path separator";
	if (value === "." || value === "..") return "must be a name, not a traversal";
	return null;
}
