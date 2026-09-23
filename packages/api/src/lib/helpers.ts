import { existsSync, readdirSync, rmSync } from "node:fs";
import type { Db } from "../db.js";
import { debug, log, error as logError } from "./logger.js";
import { mkdirOwned } from "./owned-dir.js";
import { underRoot } from "./safe-path.js";
import type { ServiceTemplate } from "./service-registry.js";
import {
	getGeneratedConfigFiles,
	getResetDirs,
	getTemplateConfigFiles,
	getTemplateResetDirs,
} from "./service-registry.js";
import { getLibraries } from "./template-vars.js";

export function createMediaDirs(db: Db): void {
	const mediaPath = db.get("paths.media") as string;
	for (const lib of getLibraries(db)) {
		mkdirOwned(underRoot(mediaPath, lib.name));
	}
	log("Media directories created");
}

/** Directories a template needs present before its container boots (`dirs:`). */
export function createTemplateDirs(db: Db, tpl: ServiceTemplate): void {
	const configPath = db.get("paths.config") as string;
	if (!configPath) return;
	for (const dir of tpl.dirs ?? []) {
		mkdirOwned(underRoot(configPath, dir));
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
	log("Cleaning config files...");
	dropConfig(db, getGeneratedConfigFiles(db), getResetDirs());
}

/**
 * The same reset, scoped to one service. Reconfiguring Jellyfin must not replay
 * Plex's startup wizard, so the lists come from that template alone.
 */
export function cleanServiceConfig(db: Db, tpl: ServiceTemplate): void {
	log(`Cleaning config files for ${tpl.id}...`);
	dropConfig(db, getTemplateConfigFiles(db, tpl), getTemplateResetDirs(tpl));
}

/**
 * Whether this service has left anything behind that a reset would drop.
 *
 * A removal keeps the service's directory under `paths.config` on purpose — it
 * holds settings the user chose, and reinstalling should find them again. The
 * cost is that a reinstall then runs a first-install pipeline against a service
 * that is already configured, which is not always the same thing.
 *
 * So the answer is the user's to give, and this is what tells the wizard whether
 * the question is worth asking: it looks at exactly the set `cleanServiceConfig`
 * would delete, no more.
 */
export function hasLeftoverConfig(db: Db, tpl: ServiceTemplate): boolean {
	const configPath = db.get("paths.config") as string;
	if (!configPath) return false;
	const targets = [
		...getTemplateConfigFiles(db, tpl),
		...getTemplateResetDirs(tpl),
	];
	return targets.some((tail) => {
		const path = contained(configPath, tail);
		return Boolean(path && existsSync(path));
	});
}

/** The path, or null after saying why it was left alone. */
function contained(base: string, tail: string): string | null {
	try {
		return underRoot(base, tail);
	} catch {
		logError(`Refusing to touch ${tail}: outside ${base}`);
		return null;
	}
}

function dropConfig(db: Db, files: string[], dirs: string[]): void {
	const configPath = db.get("paths.config") as string;
	if (!configPath) return;

	for (const file of files) {
		// Every path here is checked before it is used, because this function is
		// the only one that deletes. A template's `file:` is validated at load,
		// but it carries `{{...}}` that only expand at this point.
		const path = contained(configPath, file);
		if (!path || !existsSync(path)) continue;
		debug(`Removing ${path}`);
		rmSync(path, { force: true });
	}

	// Emptied, never replaced. A bind mount attaches to the directory itself, not
	// to its name: `rm -rf` then `mkdir` leaves the same path pointing at a new
	// object, and Docker Desktop's file sharing goes on handing the container the
	// one that was deleted — Jellyfin comes up unable to create `/config/data`,
	// and `wait_ready` then times out on an API that will never answer.
	for (const dir of dirs) {
		const path = contained(configPath, dir);
		if (!path || !existsSync(path)) continue;
		debug(`Emptying ${path}`);
		// readdir, not a shell glob: dotfiles are contents too.
		for (const entry of readdirSync(path)) {
			rmSync(underRoot(path, entry), { recursive: true, force: true });
		}
	}
}
