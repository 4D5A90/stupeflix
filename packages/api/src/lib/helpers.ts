import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Db } from "../db.js";
import { debug, log } from "./logger.js";
import type { ServiceTemplate } from "./service-registry.js";
import { getGeneratedConfigFiles, getResetDirs } from "./service-registry.js";
import { getLibraries } from "./template-vars.js";

export function createMediaDirs(db: Db): void {
	const mediaPath = db.get("paths.media") as string;
	for (const lib of getLibraries(db)) {
		mkdirSync(join(mediaPath, lib.name), { recursive: true });
	}
	log("Media directories created");
}

/** Directories a template needs present before its container boots (`dirs:`). */
export function createTemplateDirs(db: Db, tpl: ServiceTemplate): void {
	const configPath = db.get("paths.config") as string;
	if (!configPath) return;
	for (const dir of tpl.dirs ?? []) {
		mkdirSync(join(configPath, dir), { recursive: true });
	}
}

/**
 * Reconfigure is a reset: drop what setup generated so it can run again.
 *
 * The list is not written here — a template's `config_file` steps declare the files
 * it owns, and `reset.dirs` the directories whose startup wizard must be replayed.
 * Anything a template does not claim (JOAL's seeded torrents, Prowlarr's indexers)
 * is user data and survives untouched.
 */
export function cleanConfigs(db: Db): void {
	const configPath = db.get("paths.config") as string;
	if (!configPath) return;

	log("Cleaning config files...");

	for (const file of getGeneratedConfigFiles(db)) {
		const path = join(configPath, file);
		if (!existsSync(path)) continue;
		debug(`Removing ${path}`);
		rmSync(path, { force: true });
	}

	for (const dir of getResetDirs()) {
		const path = join(configPath, dir);
		if (!existsSync(path)) continue;
		debug(`Removing ${path}`);
		rmSync(path, { recursive: true, force: true });
		mkdirSync(path, { recursive: true });
	}
}
