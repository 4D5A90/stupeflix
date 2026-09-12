import type { Db } from "../db.js";
import { writeCompose } from "./compose.js";
import { runCompose } from "./docker-cli.js";
import { cleanServiceConfig, createTemplateDirs } from "./helpers.js";
import { log, error as logError } from "./logger.js";
import { affectedServices, resolveNetworkTopology } from "./network.js";
import { getEnabledTemplates } from "./service-registry.js";
import type { ServiceTemplate } from "./service-registry.js";
import {
	replayPendingSteps,
	runTemplateSteps,
	runUninstallHooks,
	statusKeysNaming,
} from "./setup-runner.js";

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
	// Read before it is written, and written here rather than by the caller: the
	// answer to "did this service exist before?" is what decides whether a failure
	// should undo the install, and a caller that sets the flag first destroys it.
	const wasInstalled = Boolean(db.get(`services.${tpl.id}.enabled`));
	try {
		db.set("setup.global", "in_progress");
		// Before `writeCompose`, which only emits the enabled templates.
		db.set(`services.${tpl.id}.enabled`, true);

		writeCompose(db);

		if (reset) {
			// The container holds its config open, so stop it before dropping files
			try {
				await runCompose(["stop", tpl.container]);
			} catch {}
			cleanServiceConfig(db, tpl);
		}

		createTemplateDirs(db, tpl);
		await runTemplateSteps(db, tpl, "pre_up");

		// A network provider and its joiners share host ports, so they come up as
		// a set — and the joiners must release those ports before the provider can
		// bind them. Without a tunnel in play this is just the service itself.
		const { all, joiners } = affectedServices(
			tpl.container,
			resolveNetworkTopology(getEnabledTemplates(db)),
		);
		if (joiners.length > 0) {
			try {
				await runCompose(["stop", ...joiners]);
			} catch {}
		}
		// Recreate on a reset: an unchanged definition would otherwise be left
		// running, still holding the config we just replaced
		await runCompose([
			"up",
			"-d",
			...(reset ? ["--force-recreate"] : []),
			...all,
		]);
		await runTemplateSteps(db, tpl, "post_up");

		// This install is what a peer's `if:` was waiting on: a step held back for
		// want of this service now has its condition, and nothing else would ever
		// go back for it. Skipping `tpl` is what keeps its own pipeline from
		// running twice.
		await replayPendingSteps(db, getEnabledTemplates(db), tpl.id);

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
			await runCompose(["stop", tpl.container]);
		} catch {}
	}
}

/**
 * The command that collects the containers the compose file no longer declares.
 *
 * Two shapes, because Compose reads the *file* and not the project. With
 * services left, `up -d --remove-orphans` reconciles: it starts what is declared
 * and removes what is not. With none left the file is `services: {}`, and `up`
 * refuses it outright — *no service selected*, exit 1 — which used to leave the
 * last service running while the API reported it removed.
 *
 * A bare `down` is not the answer either: on that same empty file it finds
 * nothing to act on and exits 0 having done nothing. `--remove-orphans` is what
 * makes it collect the containers the file stopped declaring, which by then is
 * all of them.
 */
export function removalCommand(remaining: number): string[] {
	return remaining > 0
		? ["up", "-d", "--remove-orphans"]
		: ["down", "--remove-orphans"];
}

/**
 * Drops a service: disable it, rewrite the compose file without it, and let
 * Docker collect what is no longer declared. Going through `--remove-orphans`
 * rather than naming containers is what makes a template owning several of them
 * — a service and its database, say — come down whole, with no per-service
 * knowledge here.
 *
 * Named volumes survive: neither form carries `-v`, so a template's database
 * keeps its data, the same way the service's directory under `paths.config` is
 * deliberately left alone — it is the user's settings, and reinstalling should
 * find them again.
 */
export async function removeService(
	db: Db,
	tpl: ServiceTemplate,
): Promise<void> {
	// Before the flag flips, so the steps that named this service can still be
	// found: their `if:` is what identifies them.
	const stale = statusKeysNaming(db, getEnabledTemplates(db), tpl.id);
	db.set(`services.${tpl.id}.enabled`, false);
	for (const key of stale) db.delete(`setup.status.${key}`);
	writeCompose(db);
	const remaining = getEnabledTemplates(db);
	await runCompose(removalCommand(remaining.length));
	// After the container is gone: the entries being dropped live in peers that
	// stay up, and they are only truly dead once the thing they pointed at is.
	await runUninstallHooks(db, remaining, tpl.id);
	// No replay here, deliberately. It would only serve a step guarded on this
	// service being *absent*, and `if:` tests equality to "true" and nothing else
	// — there is no way to write that condition today. Adding the call now would
	// be a mechanism for a case that cannot exist.
	log(`[remove] ${tpl.id} removed`);
}
