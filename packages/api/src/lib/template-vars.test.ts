import { describe, expect, it } from "vitest";
import { configuredDb, fakeDb } from "../test/fake-db.js";
import { PGID, PUID, TZ } from "./env.js";
import {
	buildVars,
	getLibraries,
	resolveTemplateVars,
} from "./template-vars.js";

describe("resolveTemplateVars", () => {
	const vars = { "credentials.user": "hugo", "paths.media": "/srv/media" };

	it("substitutes into strings", () => {
		expect(resolveTemplateVars("{{paths.media}}/Movies", vars)).toBe(
			"/srv/media/Movies",
		);
	});

	it("substitutes several times in one string", () => {
		expect(
			resolveTemplateVars("{{credentials.user}}@{{credentials.user}}", vars),
		).toBe("hugo@hugo");
	});

	it("walks arrays and nested objects", () => {
		const input = {
			volumes: ["{{paths.media}}:/media"],
			deep: { user: "{{credentials.user}}" },
		};
		expect(resolveTemplateVars(input, vars)).toEqual({
			volumes: ["/srv/media:/media"],
			deep: { user: "hugo" },
		});
	});

	it("passes non-strings through untouched", () => {
		expect(resolveTemplateVars(8080, vars)).toBe(8080);
		expect(resolveTemplateVars(true, vars)).toBe(true);
		expect(resolveTemplateVars(null, vars)).toBe(null);
	});

	it("empties an unknown variable rather than leaving the placeholder", () => {
		expect(resolveTemplateVars("PLEX_CLAIM={{credentials.claim}}", vars)).toBe(
			"PLEX_CLAIM=",
		);
	});

	it("leaves compose's own $$ escaping alone", () => {
		expect(resolveTemplateVars("pg_isready -d $${POSTGRES_DB}", vars)).toBe(
			"pg_isready -d $${POSTGRES_DB}",
		);
	});

	it("leaves single-brace placeholders alone (JOAL's tracker query)", () => {
		expect(resolveTemplateVars("info_hash={infohash}&port={port}", vars)).toBe(
			"info_hash={infohash}&port={port}",
		);
	});
});

describe("buildVars", () => {
	it("exposes host paths and env wiring", () => {
		const vars = buildVars(configuredDb(), "qbittorrent");
		expect(vars["paths.config"]).toBe("/srv/config");
		expect(vars["paths.media"]).toBe("/srv/media");
		expect(vars["paths.torrents"]).toBe("/srv/torrents");
		expect(vars["env.PUID"]).toBe(PUID);
		expect(vars["env.PGID"]).toBe(PGID);
		expect(vars["env.TZ"]).toBe(TZ);
	});

	it("unprefixes the current service's own credentials and secrets", () => {
		const vars = buildVars(
			configuredDb({
				"credentials.qbittorrent.user": "hugo",
				"internal.qbittorrent.temp_pass": "abc123",
			}),
			"qbittorrent",
		);
		expect(vars["credentials.user"]).toBe("hugo");
		expect(vars["internal.temp_pass"]).toBe("abc123");
	});

	it("keeps another service's values reachable under their full key", () => {
		const vars = buildVars(
			configuredDb({
				"internal.prowlarr.api_key": "deadbeef",
				"credentials.qbittorrent.user": "hugo",
			}),
			"mediamanager",
		);
		expect(vars["internal.prowlarr.api_key"]).toBe("deadbeef");
		expect(vars["credentials.qbittorrent.user"]).toBe("hugo");
		// ...and does not leak them as if they were its own
		expect(vars["internal.api_key"]).toBeUndefined();
		expect(vars["credentials.user"]).toBeUndefined();
	});

	it("renders enable flags as strings a container can read", () => {
		const vars = buildVars(
			configuredDb({
				"services.prowlarr.enabled": true,
				"services.plex.enabled": false,
			}),
			"mediamanager",
		);
		expect(vars["services.prowlarr.enabled"]).toBe("true");
		expect(vars["services.plex.enabled"]).toBe("false");
	});

	it("groups libraries by type as JSON, with container-side paths", () => {
		const vars = buildVars(configuredDb(), "mediamanager");
		expect(JSON.parse(vars["libraries.movies_json"])).toEqual([
			{ name: "Movies", path: "/media/Movies" },
		]);
		expect(JSON.parse(vars["libraries.tvshows_json"])).toEqual([
			{ name: "TvShows", path: "/media/TvShows" },
		]);
	});

	it("emits an empty array for a known type with no library", () => {
		// Otherwise the variable resolves to "" and the container gets invalid JSON
		expect(
			buildVars(configuredDb(), "mediamanager")["libraries.music_json"],
		).toBe("[]");
	});

	it("covers a custom library type too", () => {
		const db = configuredDb({
			libraries: JSON.stringify([{ name: "Anime", type: "anime" }]),
		});
		expect(
			JSON.parse(buildVars(db, "mediamanager")["libraries.anime_json"]),
		).toEqual([{ name: "Anime", path: "/media/Anime" }]);
	});
});

describe("getLibraries", () => {
	it("falls back to Movies + TvShows when unset", () => {
		expect(getLibraries(fakeDb())).toEqual([
			{ name: "Movies", type: "movies" },
			{ name: "TvShows", type: "tvshows" },
		]);
	});

	it("falls back rather than throwing on corrupt JSON", () => {
		expect(getLibraries(fakeDb({ libraries: "not json" }))).toHaveLength(2);
	});
});
