import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Db } from "../db.js";
import { writeCompose } from "./compose.js";
import { compose } from "./docker-cli.js";
import { cleanServiceConfig, createTemplateDirs } from "./helpers.js";
import { log, error as logError } from "./logger.js";
import type { ServiceTemplate } from "./service-registry.js";
import { runTemplateSteps } from "./setup-runner.js";

const execAsync = promisify(exec);

interface InstallOptions {
	/**
	 * Replay the service from scratch: drop the config its template declares
	 * owning, then recreate the container so it reads the fresh files. Without
	 * this a `config_file` step with `skipIfExists` would leave the old config
	 * in place and the service would look untouched.
	 */
	reset?: boolean;
}

/**
 * Drives one service through its template — the same path for a first install
 * and for a reconfigure, so the two can never drift apart.
 */
export async function runServiceInstall(
	db: Db,
	tpl: ServiceTemplate,
	{ reset = false }: InstallOptions = {},
): Promise<void> {
	const wasInstalled = Boolean(db.get(`services.${tpl.id}.enabled`));
	try {
		db.set("setup.global", "in_progress");

		writeCompose(db);

		if (reset) {
			// The container holds its config open, so stop it before dropping files
			try {
				await execAsync(compose(`stop ${tpl.container}`));
			} catch {}
			cleanServiceConfig(db, tpl);
		}

		createTemplateDirs(db, tpl);
		await runTemplateSteps(db, tpl, "pre_up");
		// Recreate on a reset: an unchanged definition would otherwise be left
		// running, still holding the config we just replaced
		await execAsync(
			compose(`up -d ${reset ? "--force-recreate " : ""}${tpl.container}`),
		);
		await runTemplateSteps(db, tpl, "post_up");

		db.set("setup.global", "completed");
		db.set("setup.error", null);
		log(`[install] ${tpl.id} ${reset ? "reconfigured" : "installed"}`);
	} catch (e) {
		logError(`[install:${tpl.id}] failed`, e);
		// A failed first install leaves nothing behind; a failed reconfigure must
		// not silently uninstall a service the user already had
		if (!wasInstalled) db.set(`services.${tpl.id}.enabled`, false);
		db.set("setup.global", "failed");
		db.set("setup.error", e instanceof Error ? e.message : String(e));
		try {
			await execAsync(compose(`stop ${tpl.container}`));
		} catch {}
	}
}

/**
 * Drops a service: disable it, rewrite the compose file without it, and let
 * Docker collect what is no longer declared. Going through `--remove-orphans`
 * rather than naming containers is what makes a template with a sidecar (the
 * MediaManager database) come down whole, with no per-service knowledge here.
 *
 * The service's directory under `paths.config` is deliberately left alone: it is
 * the user's settings, and reinstalling should find them again.
 */
export async function removeService(
	db: Db,
	tpl: ServiceTemplate,
): Promise<void> {
	db.set(`services.${tpl.id}.enabled`, false);
	writeCompose(db);
	await execAsync(compose("up -d --remove-orphans"));
	log(`[remove] ${tpl.id} removed`);
}
