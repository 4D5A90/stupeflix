import { useSyncExternalStore } from "react";

const KEY = "stupeflix.night";
const listeners = new Set<() => void>();

// Storage can be missing or refuse writes (a private window); the screens
// then simply start light and the toggle lasts as long as the tab.
let night = (() => {
	try {
		return localStorage.getItem(KEY) === "1";
	} catch {
		return false;
	}
})();

function setNight(value: boolean): void {
	night = value;
	try {
		localStorage.setItem(KEY, value ? "1" : "0");
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
 * Night mode for the light screens, chosen in the top bar and kept in this
 * browser. Module state rather than context: every Shell reads the same one,
 * and switching screens must not flash white.
 */
export function useNight(): [boolean, () => void] {
	const value = useSyncExternalStore(subscribe, () => night);
	return [value, () => setNight(!night)];
}
