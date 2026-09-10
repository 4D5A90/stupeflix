import { readdirSync, statfsSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import type { Db } from "../db.js";
import { underRoot } from "./safe-path.js";
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
/**
 * How far down the walk goes. A media tree is Library/Show/Season/File, so this
 * is generous; without it a symlink-free but pathological tree blocks the event
 * loop for as long as it takes, on an endpoint anyone can call repeatedly.
 */
const MAX_DEPTH = 12;

function countMediaFiles(dir: string, type: string, depth = MAX_DEPTH): number {
	if (depth <= 0) return 0;
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
			total += countMediaFiles(join(dir, entry.name), type, depth - 1);
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
	// The name is the user's, and this walk is synchronous: a library called
	// `../..` would put the event loop through the whole disk, and report the
	// counts of somebody else's directories.
	const dir = underRoot(root, library.name);
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
	const libraries: LibraryStat[] = [];
	for (const library of getLibraries(db)) {
		// A name that climbs out is not a library to report on. Dropped rather
		// than thrown: the dashboard's tiles must not go dark over one bad row.
		try {
			libraries.push(statLibrary(root, library));
		} catch {}
	}
	return { libraries, disk: statDisk(root) };
}
