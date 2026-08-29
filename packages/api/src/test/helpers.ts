import { getTemplate } from "../lib/service-registry.js";
import type { ServiceTemplate, SetupStepDef } from "../lib/service-registry.js";

/** Like getTemplate, but a missing template is a test failure with a name in it. */
export function template(id: string): ServiceTemplate {
	const tpl = getTemplate(id);
	if (!tpl) throw new Error(`No template "${id}" loaded`);
	return tpl;
}

export function stepOfType(
	tpl: ServiceTemplate,
	type: SetupStepDef["type"],
): SetupStepDef {
	const step = tpl.setup.find((s) => s.type === type);
	if (!step) throw new Error(`Template "${tpl.id}" has no ${type} step`);
	return step;
}

export function lastStep(tpl: ServiceTemplate): SetupStepDef {
	const step = tpl.setup.at(-1);
	if (!step) throw new Error(`Template "${tpl.id}" has no setup steps`);
	return step;
}
