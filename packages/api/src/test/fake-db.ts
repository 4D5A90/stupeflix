import type { Db } from "../db.js";

/**
 * In-memory stand-in for the sql.js wrapper. The real Db serialises through
 * JSON, so mirror that here: a test that stores a value must read back exactly
 * what the engine would.
 */
export function fakeDb(initial: Record<string, unknown> = {}): Db {
	const store = new Map(
		Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]),
	);
	return {
		get: (key) =>
			store.has(key) ? JSON.parse(store.get(key) as string) : null,
		set: (key, value) => {
			store.set(key, JSON.stringify(value));
		},
		all: () =>
			Object.fromEntries(
				[...store].map(([k, v]) => [k, JSON.parse(v as string)]),
			),
		delete: (key) => {
			store.delete(key);
		},
	};
}

/** A wizard that has been through the Paths step, with two libraries. */
export function configuredDb(extra: Record<string, unknown> = {}): Db {
	return fakeDb({
		"paths.config": "/srv/config",
		"paths.media": "/srv/media",
		"paths.torrents": "/srv/torrents",
		libraries: JSON.stringify([
			{ name: "Movies", type: "movies" },
			{ name: "TvShows", type: "tvshows" },
		]),
		...extra,
	});
}
