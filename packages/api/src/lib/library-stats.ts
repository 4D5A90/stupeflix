import { readdirSync, statfsSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import type { Db } from "../db.js";
import { getLibraries } from "./template-vars.js";
import type { Library } from "./template-vars.js";

/**
 * Counts are read from the filesystem rather than from a media server's API, so
 * they stay true when Jellyfin is stopped and no service is treated as the
 * canonical one. The trade-off is that the numbers follow the folder layout, not
 * what a scanner eventually matched.
 */

const VIDEO = new Set([
	"mkv",
	"mp4",
	"avi",
	"mov",
	"m4v",
	"wmv",
	"mpg",
	"mpeg",
	"ts",
	"webm",
]);
const AUDIO = new Set([
	"mp3",
	"flac",
	"m4a",
	"ogg",
	"opus",
	"wav",
	"aac",
	"wma",
]);

/** What a library's two numbers mean, per type. */
const UNITS: Record<string, { primary: string; secondary: string }> = {
	movies: { primary: "titles", secondary: "files" },
	tvshows: { primary: "series", secondary: "episodes" },
	music: { primary: "albums", secondary: "tracks" },
};

const DEFAULT_UNITS = { primary: "folders", secondary: "files" };

export interface LibraryStat {
	name: string;
	type: string;
	/** Series / albums / movie titles — the thing you browse. */
	primary: number;
	/** Episodes / tracks / files — what those contain. */
	secondary: number;
	primaryUnit: string;
	secondaryUnit: string;
}

export interface DiskStat {
	total: number;
	free: number;
	used: number;
}

export interface LibraryStats {
	libraries: LibraryStat[];
	disk: DiskStat | null;
}

function extension(name: string): string {
	const dot = name.lastIndexOf(".");
	return dot < 1 ? "" : name.slice(dot + 1).toLowerCase();
}

function isMedia(name: string, type: string): boolean {
	const ext = extension(name);
	return type === "music" ? AUDIO.has(ext) : VIDEO.has(ext);
}

/** Media files anywhere under `dir`. Hidden entries are skipped — .DS_Store, @eaDir. */
function countMediaFiles(dir: string, type: string): number {
	let total = 0;
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return 0;
	}
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		if (entry.isDirectory())
			total += countMediaFiles(join(dir, entry.name), type);
		else if (isMedia(entry.name, type)) total++;
	}
	return total;
}

/**
 * One library's numbers.
 *
 * `primary` counts what you actually browse, which is a folder for a series or an
 * album but may be a bare file for a movie — Jellyfin accepts `Movies/Title.mkv`
 * while a series always needs its own directory. So a top-level media file counts
 * as one title, and a top-level directory counts as one series/album.
 */
export function statLibrary(root: string, library: Library): LibraryStat {
	const units = UNITS[library.type] ?? DEFAULT_UNITS;
	const dir = join(root, library.name);
	const stat: LibraryStat = {
		name: library.name,
		type: library.type,
		primary: 0,
		secondary: 0,
		primaryUnit: units.primary,
		secondaryUnit: units.secondary,
	};

	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		// A library whose folder is missing reads as empty, not as an error: the
		// wizard creates it, but the user may not have populated it yet.
		return stat;
	}

	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		if (entry.isDirectory()) stat.primary++;
		else if (isMedia(entry.name, library.type)) stat.primary++;
	}
	stat.secondary = countMediaFiles(dir, library.type);
	return stat;
}

/** Free space on the filesystem holding `path`. Null when it cannot be read. */
export function statDisk(path: string): DiskStat | null {
	try {
		const fs = statfsSync(path);
		const total = fs.blocks * fs.bsize;
		// `bavail` is what a non-root process may actually use, unlike `bfree`
		const free = fs.bavail * fs.bsize;
		return { total, free, used: total - free };
	} catch {
		return null;
	}
}

/**
 * Every configured library plus the disk holding them. All libraries live under
 * the single media root today, so one disk entry covers them all — see the
 * `path` note in template-vars if that ever stops being true.
 */
export function getLibraryStats(db: Db): LibraryStats {
	const root = (db.get("paths.media") as string) ?? "";
	if (!root) return { libraries: [], disk: null };
	return {
		libraries: getLibraries(db).map((l) => statLibrary(root, l)),
		disk: statDisk(root),
	};
}
