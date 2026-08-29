import type { Db } from "../db.js";
import { log } from "./logger.js";
import type { ServiceTemplate, SetupStepDef } from "./service-registry.js";
import { runSetupStep } from "./service-registry.js";
import { getLibraries } from "./template-vars.js";

export type StepStatus = "pending" | "in_progress" | "completed" | "failed";

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

interface StepRun {
	key: string;
	label: string;
	vars?: Record<string, string>;
}

/** One run per library for `foreach: libraries` steps, otherwise a single run. */
function expandStep(
	db: Db,
	tpl: ServiceTemplate,
	step: SetupStepDef,
): StepRun[] {
	if (step.foreach !== "libraries") {
		return [{ key: `${tpl.id}.${step.name}`, label: step.label }];
	}
	return getLibraries(db).map((lib) => {
		const vars: Record<string, string> = {
			"library.name": lib.name,
			"library.type": lib.type,
		};
		for (const [k, v] of Object.entries(step.typeMap?.[lib.type] ?? {})) {
			vars[`library.${k}`] = v;
		}
		return {
			key: `${tpl.id}.${step.name}_${lib.name}`,
			label: `${step.label} (${lib.name})`,
			vars,
		};
	});
}

/** Every status key this template contributes, in display order. */
export function stepKeys(db: Db, tpl: ServiceTemplate): string[] {
	return tpl.setup.flatMap((step) =>
		expandStep(db, tpl, step).map((run) => run.key),
	);
}

/** Runs one phase of a template's setup. Throws on the first failing step. */
export async function runTemplateSteps(
	db: Db,
	tpl: ServiceTemplate,
	phase: StepPhase,
): Promise<void> {
	for (const step of tpl.setup) {
		if (stepPhase(step) !== phase) continue;
		for (const run of expandStep(db, tpl, step)) {
			setStepStatus(db, run.key, "in_progress");
			log(`Running ${run.label}...`);

			const err = await runSetupStep(step, db, tpl.id, run.vars);
			if (err) {
				setStepStatus(db, run.key, "failed");
				throw new Error(`${run.label}: ${err}`);
			}

			setStepStatus(db, run.key, "completed");
			log(`${run.label} completed`);
		}
	}
}
