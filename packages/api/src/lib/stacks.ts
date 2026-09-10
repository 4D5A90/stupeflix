import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { debug, log, error as logError } from "./logger.js";
import { getTemplate } from "./service-registry.js";

/**
 * A named set of services that work together — the shortcut past choosing ten
 * things one by one.
 *
 * Stacks live in their own directory rather than carrying a `kind:` field
 * beside the templates: the path is the discriminant, so there is nothing to
 * describe, nothing to forget in a file, and no default to rule on for the
 * templates that predate them.
 */
export interface Stack {
	id: string;
	name: string;
	description: string;
	/**
	 * A literal glyph, not a name — unlike a template action's `icon:`, which is
	 * looked up in `ActionIcon.tsx`. Nothing resolves this, the card prints it.
	 */
	emoji?: string;
	/** Template ids, in no particular order. */
	services: string[];
}

let stacks: Stack[] = [];
let stacksDir = "";

/** Why this file is not a stack, or null. Far less to check than a template. */
function stackProblem(value: unknown): string | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return "not a mapping";
	}
	const stack = value as Record<string, unknown>;
	for (const key of ["id", "name", "description"]) {
		if (typeof stack[key] !== "string" || stack[key] === "") {
			return `${key} is required`;
		}
	}
	if (
		!Array.isArray(stack.services) ||
		!stack.services.every((id) => typeof id === "string")
	) {
		return "services must be a list of template ids";
	}
	return null;
}

/** Shipping stacks is optional: an absent directory is an empty list, not an error. */
export function loadStacks(dir: string): void {
	stacksDir = dir;
	stacks = [];
	if (!existsSync(dir)) {
		debug(`No stacks directory at ${dir}`);
		return;
	}
	const files = readdirSync(dir).filter(
		(f) => f.endsWith(".yml") || f.endsWith(".yaml"),
	);
	for (const file of files) {
		// `getStacks` walks `services` on every call, so a stack missing it breaks
		// the wizard's Services step rather than its own card.
		try {
			const parsed: unknown = parse(readFileSync(join(dir, file), "utf-8"));
			const problem = stackProblem(parsed);
			if (problem) {
				logError(`Ignored stack ${file}`, problem);
				continue;
			}
			const stack = parsed as Stack;
			stacks.push(stack);
			log(`Loaded stack: ${stack.id}`);
		} catch (e) {
			logError(`Ignored stack ${file}`, e instanceof Error ? e.message : e);
		}
	}
}

export function reloadStacks(): void {
	if (stacksDir) loadStacks(stacksDir);
}

/**
 * Only the stacks this install can actually offer. One naming a service whose
 * template is absent is dropped rather than shown and failing — which is why
 * the wizard only ever has to ask whether the list is empty, never why.
 */
export function getStacks(): Stack[] {
	return stacks.filter((s) => s.services.every((id) => getTemplate(id)));
}
