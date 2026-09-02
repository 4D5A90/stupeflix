import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { debug, log } from "./logger.js";
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
	/** Template ids, in no particular order. */
	services: string[];
}

let stacks: Stack[] = [];
let stacksDir = "";

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
		const stack = parse(readFileSync(join(dir, file), "utf-8")) as Stack;
		stacks.push(stack);
		log(`Loaded stack: ${stack.id}`);
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
