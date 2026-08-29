import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeDb } from "../test/fake-db.js";
import { getLibraryStats, statDisk, statLibrary } from "./library-stats.js";

let root: string;

function file(...parts: string[]) {
	const path = join(root, ...parts);
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, "");
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "stupeflix-lib-"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("statLibrary: tvshows", () => {
	it("counts a folder as a series and every video below it as an episode", () => {
		file("TvShows", "Silo", "Season 03", "Silo S03E09.mkv");
		file("TvShows", "Silo", "Season 03", "Silo S03E10.mkv");
		file("TvShows", "Severance", "Season 01", "Severance S01E01.mkv");

		const stat = statLibrary(root, { name: "TvShows", type: "tvshows" });
		expect(stat).toMatchObject({ primary: 2, secondary: 3 });
		expect(stat.primaryUnit).toBe("series");
	});

	/** The layout that started all this: an episode dropped at the library root. */
	it("still counts a loose episode, even though Jellyfin would not show it", () => {
		file("TvShows", "Silo.S03E09.mkv");
		expect(
			statLibrary(root, { name: "TvShows", type: "tvshows" }),
		).toMatchObject({ primary: 1, secondary: 1 });
	});

	it("ignores hidden entries, so .DS_Store is never a series", () => {
		file("TvShows", ".DS_Store");
		file("TvShows", ".hidden", "nope.mkv");
		expect(
			statLibrary(root, { name: "TvShows", type: "tvshows" }),
		).toMatchObject({ primary: 0, secondary: 0 });
	});

	it("ignores files the media servers would not play", () => {
		file("TvShows", "Silo", "Season 03", "Silo S03E09.mkv");
		file("TvShows", "Silo", "Season 03", "Silo S03E09.srt");
		file("TvShows", "Silo", "poster.jpg");
		expect(
			statLibrary(root, { name: "TvShows", type: "tvshows" }),
		).toMatchObject({ primary: 1, secondary: 1 });
	});
});

describe("statLibrary: movies and music", () => {
	it("counts a bare movie file as a title, since Jellyfin accepts it flat", () => {
		file("Movies", "Dune (2021).mkv");
		file("Movies", "Arrival (2016)", "Arrival.mp4");
		expect(statLibrary(root, { name: "Movies", type: "movies" })).toMatchObject(
			{
				primary: 2,
				secondary: 2,
				primaryUnit: "titles",
			},
		);
	});

	it("counts audio, not video, in a music library", () => {
		file("Music", "Album", "01.flac");
		file("Music", "Album", "cover.mkv");
		expect(statLibrary(root, { name: "Music", type: "music" })).toMatchObject({
			primary: 1,
			secondary: 1,
			secondaryUnit: "tracks",
		});
	});

	it("reads an unknown type without inventing units", () => {
		file("Photos", "2024", "a.mkv");
		expect(statLibrary(root, { name: "Photos", type: "photos" })).toMatchObject(
			{
				primaryUnit: "folders",
				secondaryUnit: "files",
			},
		);
	});
});

describe("statLibrary: missing folder", () => {
	it("reads as empty rather than throwing, since the user may not have filled it", () => {
		expect(statLibrary(root, { name: "Anime", type: "tvshows" })).toMatchObject(
			{
				name: "Anime",
				primary: 0,
				secondary: 0,
			},
		);
	});
});

describe("statDisk", () => {
	it("reports a filesystem that has more room than it uses", () => {
		const disk = statDisk(root);
		expect(disk).not.toBeNull();
		if (!disk) return;
		expect(disk.total).toBeGreaterThan(0);
		expect(disk.free).toBeGreaterThan(0);
		expect(disk.used).toBe(disk.total - disk.free);
	});

	it("returns null for a path that does not exist", () => {
		expect(statDisk(join(root, "nope"))).toBeNull();
	});
});

describe("getLibraryStats", () => {
	it("covers every configured library, in order", () => {
		file("Movies", "Dune (2021).mkv");
		file("TvShows", "Silo", "Season 03", "Silo S03E09.mkv");
		const db = fakeDb({
			"paths.media": root,
			libraries: JSON.stringify([
				{ name: "Movies", type: "movies" },
				{ name: "TvShows", type: "tvshows" },
			]),
		});

		const stats = getLibraryStats(db);
		expect(stats.libraries.map((l) => l.name)).toEqual(["Movies", "TvShows"]);
		expect(stats.libraries[1]).toMatchObject({ primary: 1, secondary: 1 });
		expect(stats.disk).not.toBeNull();
	});

	it("says nothing at all before the wizard has set a media path", () => {
		expect(getLibraryStats(fakeDb({}))).toEqual({ libraries: [], disk: null });
	});
});
