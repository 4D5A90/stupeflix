import type { ServiceInfo } from "../../api/client";

export type Tone = "ok" | "warn" | "fail" | "faint";

/** The badge's dot: the only place a row's state is coloured. */
export const TONE_DOT: Record<Tone, string> = {
	ok: "bg-ok",
	warn: "bg-warn",
	fail: "bg-fail",
	faint: "bg-faint",
};

export interface StatusWord {
	word: string;
	tone: Tone;
	/** The sentence behind it, for the billboard; the row only has room for the word. */
	reason?: string;
}

/** What Docker says about the container, and nothing else. */
export function containerState(service: ServiceInfo): StatusWord {
	switch (service.status) {
		case "running":
			return { word: "Running", tone: "ok" };
		case "restarting":
			return { word: "Restarting", tone: "warn" };
		case "exited":
			return { word: "Exited", tone: "fail" };
		default:
			return { word: "Missing", tone: "faint" };
	}
}

/**
 * Conditions that are not the container's state, and must not be folded into
 * it: a service can run perfectly and still be unable to do its job. The
 * billboard shows them *beside* the state — replacing `Running` would lose the
 * one fact that says the container is up.
 */
export function conditions(service: ServiceInfo): StatusWord[] {
	const out: StatusWord[] = [];
	if (service.health === "unhealthy")
		out.push({
			word: "Unhealthy",
			tone: "warn",
			reason: "The container is running, but its healthcheck is failing.",
		});
	if (service.health === "starting")
		out.push({
			word: "Starting",
			tone: "warn",
			reason: "The container is up, and its healthcheck has not passed yet.",
		});
	if (service.unmet.length > 0)
		out.push({
			word: "Incomplete",
			tone: "warn",
			// The template already writes it for a human to read.
			reason: service.unmet
				.map((u) => u.reason ?? `Requires a "${u.category}" service.`)
				.join(" "),
		});
	return out;
}

/**
 * The one word a row has room for: the container's state when it is not
 * running, else the first condition, else "Running" — green, as on the
 * billboard, so a row and its billboard never disagree on the same state.
 */
export function rowStatus(service: ServiceInfo): StatusWord {
	const state = containerState(service);
	if (service.status !== "running") return state;
	return conditions(service)[0] ?? { word: "Running", tone: "ok" };
}
