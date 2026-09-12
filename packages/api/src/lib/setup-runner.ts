import type { Db } from "../db.js";
import { log } from "./logger.js";
import type {
	ForeachSpec,
	ServiceTemplate,
	SetupStepDef,
} from "./service-registry.js";
import { SKIPPED, runSetupStep } from "./service-registry.js";
import {
	buildVars,
	getLibraries,
	resolveTemplateVars,
} from "./template-vars.js";

/**
 * `skipped` is a success that sent nothing: the step's `skipIf` probe found the
 * work already done. It reads as done everywhere, but the distinction is what
 * lets a screen say "already configured" instead of claiming a call it never
 * made.
 */
export type StepStatus =
	| "pending"
	| "in_progress"
	| "completed"
	| "skipped"
	| "failed";

/**
 * A container reads its config file at boot, so the steps that write one run
 * before `compose up` and every other step after it.
 */
export type StepPhase = "pre_up" | "post_up";

export function stepPhase(step: SetupStepDef): StepPhase {
	return step.type === "config_file" ? "pre_up" : "post_up";
}

export function setStepStatus(db: Db, key: string, status: StepStatus): void {
	db.set(`setup.status.${key}`, status);
}

/**
 * A step guarded by `if:` runs only when its condition resolves to `"true"` —
 * and when it does not, it never appears in the status list either, so the UI
 * never shows a step that was never going to run.
 */
export function stepEnabled(
	db: Db,
	tpl: ServiceTemplate,
	step: SetupStepDef,
): boolean {
	if (step.if === undefined) return true;
	const vars = buildVars(db, tpl.id);
	const conditions = Array.isArray(step.if) ? step.if : [step.if];
	return conditions.every(
		(cond) => String(resolveTemplateVars(cond, vars)).trim() === "true",
	);
}

export interface StepRun {
	key: string;
	label: string;
	vars?: Record<string, string>;
}

/** The scalar shorthand and the long form, reduced to one shape. */
export function foreachSpec(step: SetupStepDef): ForeachSpec | null {
	if (!step.foreach) return null;
	return typeof step.foreach === "string"
		? { source: step.foreach }
		: step.foreach;
}

/**
 * One run per library for `foreach: libraries` steps, otherwise a single run.
 * `type` narrows it to the libraries of one kind.
 */
function expandStep(
	db: Db,
	tpl: ServiceTemplate,
	step: SetupStepDef,
): StepRun[] {
	const spec = foreachSpec(step);
	if (spec?.source !== "libraries") {
		return [{ key: `${tpl.id}.${step.name}`, label: step.label }];
	}
	return getLibraries(db)
		.filter((lib) => !spec.type || lib.type === spec.type)
		.map((lib) => {
			const vars: Record<string, string> = {
				"library.name": lib.name,
				"library.type": lib.type,
			};
			for (const [k, v] of Object.entries(spec.map?.[lib.type] ?? {})) {
				vars[`library.${k}`] = v;
			}
			return {
				key: `${tpl.id}.${step.name}_${lib.name}`,
				label: `${step.label} (${lib.name})`,
				vars,
			};
		});
}

/**
 * Every status key this template contributes, with the label its template
 * declares — the frontend has no other way to learn that `create_user` is
 * "Create admin user".
 */
export function stepRuns(
	db: Db,
	tpl: ServiceTemplate,
): { key: string; label: string }[] {
	return tpl.setup
		.filter((step) => stepEnabled(db, tpl, step))
		.flatMap((step) =>
			expandStep(db, tpl, step).map(({ key, label }) => ({ key, label })),
		);
}

/** Every status key this template contributes, in display order. */
export function stepKeys(db: Db, tpl: ServiceTemplate): string[] {
	return stepRuns(db, tpl).map((run) => run.key);
}

/**
 * One run of one step, statuses included. Shared so that a first install and a
 * later replay can never record an outcome differently.
 *
 * Returns the failure rather than throwing: a template's own pipeline stops on
 * the first error, while a replay across peers must not let one broken service
 * hide the others.
 */
async function runOne(
	db: Db,
	tpl: ServiceTemplate,
	step: SetupStepDef,
	run: StepRun,
): Promise<string | null> {
	setStepStatus(db, run.key, "in_progress");
	log(`Running ${run.label}...`);

	const err = await runSetupStep(step, db, tpl.id, run.vars);
	// Checked before the truthiness test below: a symbol is truthy, and a skip is
	// not a failure.
	if (err === SKIPPED) {
		setStepStatus(db, run.key, "skipped");
		log(`${run.label} skipped: already configured`);
		return null;
	}
	if (err) {
		// An optional step reads as `skipped`, not `failed`: it did not go wrong,
		// it had nothing to do. The reason still reaches the log, so a step that
		// failed for a real reason is not silently swallowed.
		if (step.optional) {
			setStepStatus(db, run.key, "skipped");
			log(`${run.label} skipped: optional, and ${err}`);
			return null;
		}
		setStepStatus(db, run.key, "failed");
		return `${run.label}: ${err}`;
	}
	setStepStatus(db, run.key, "completed");
	log(`${run.label} completed`);
	return null;
}

/** Runs one phase of a template's setup. Throws on the first failing step. */
export async function runTemplateSteps(
	db: Db,
	tpl: ServiceTemplate,
	phase: StepPhase,
): Promise<void> {
	for (const step of tpl.setup) {
		if (stepPhase(step) !== phase) continue;
		if (!stepEnabled(db, tpl, step)) {
			log(`Skipping ${step.label}: ${step.if} is not true`);
			continue;
		}
		for (const run of expandStep(db, tpl, step)) {
			const err = await runOne(db, tpl, step, run);
			if (err) throw new Error(err);
		}
	}
}

/**
 * Steps this template has never had a chance to run.
 *
 * A step held back by its `if:` never enters the status list at all, so the
 * absence of a status *is* the record that it was passed over — no extra
 * bookkeeping, and no need to remember what the condition evaluated to last
 * time. Once the condition turns true, the step is simply one with no status.
 *
 * That is what makes installing a peer after the fact work: Sonarr's
 * `register_in_prowlarr` was skipped when Prowlarr was absent, and a later
 * install of Prowlarr leaves it sitting here.
 *
 * **`post_up` only.** A `config_file` step is read by its container at boot, so
 * writing one now would change a file nobody rereads — recreating the container
 * is a reconfigure, not a replay, and the user has to ask for that.
 */
export function pendingRuns(
	db: Db,
	tpl: ServiceTemplate,
): { step: SetupStepDef; run: StepRun }[] {
	return tpl.setup
		.filter((step) => stepPhase(step) === "post_up")
		.filter((step) => stepEnabled(db, tpl, step))
		.flatMap((step) => expandStep(db, tpl, step).map((run) => ({ step, run })))
		.filter(({ run }) => db.get(`setup.status.${run.key}`) == null);
}

/**
 * Runs what every other enabled template was never able to run yet.
 *
 * Called after anything that changes `services.*.enabled`, which is the only
 * thing a peer's `if:` reads. `skipId` is the template that just ran its own
 * pipeline — replaying it here would double every step it just took.
 *
 * A failure is recorded and stepped over rather than thrown: the install that
 * triggered this already succeeded, and one peer that will not wire up is not a
 * reason to report it as failed.
 */
export async function replayPendingSteps(
	db: Db,
	templates: ServiceTemplate[],
	skipId?: string,
): Promise<void> {
	for (const tpl of templates) {
		if (tpl.id === skipId) continue;
		for (const { step, run } of pendingRuns(db, tpl)) {
			log(`Replaying ${tpl.id}: ${run.label} — its condition now holds`);
			const err = await runOne(db, tpl, step, run).catch((e) =>
				e instanceof Error ? e.message : String(e),
			);
			if (err) log(`Replay of ${tpl.id} stopped at ${run.label}: ${err}`);
		}
	}
}
