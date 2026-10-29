import { useSyncExternalStore } from "react";

const KEY = "stupeflix.tileOrder";
const listeners = new Set<() => void>();

// Same contract as night mode: storage can be missing, refuse writes or hold
// something else entirely, and the dashboard then shows the API's order.
let order: string[] = (() => {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
		return Array.isArray(parsed)
			? parsed.filter((id): id is string => typeof id === "string")
			: [];
	} catch {
		return [];
	}
})();

function setOrder(value: string[]): void {
	order = value;
	try {
		localStorage.setItem(KEY, JSON.stringify(value));
	} catch {}
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * The order the service cards were dragged into, kept in this browser: each
 * device arranges its own dashboard. See `applyOrder` for how it meets the
 * services that are actually installed.
 */
export function useTileOrder(): [string[], (value: string[]) => void] {
	return [useSyncExternalStore(subscribe, () => order), setOrder];
}
