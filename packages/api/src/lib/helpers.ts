import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { ASSETS_DIR } from "./env.js";
import { debug, log } from "./logger.js";

export function cleanConfigs(configPath: string): void {
	const files = [
		"transmission/settings.json",
		"qbittorrent/qBittorrent/qBittorrent.conf",
		"mediamanager/config/config.toml",
	];
	// Jellyfin and Emby: remove entire config to reset the startup wizard
	const dirs = [
		"jellyfin",
		"emby",
	];
	log("Cleaning config files...");

	for (const file of files) {
		const path = `${configPath}/${file}`;
		if (existsSync(path)) {
			debug(`Removing ${path}`);
			rmSync(path, { force: true });
		}
	}

	for (const dir of dirs) {
		const path = `${configPath}/${dir}`;
		if (existsSync(path)) {
			debug(`Removing ${path}`);
			rmSync(path, { recursive: true, force: true });
			mkdirSync(path, { recursive: true });
		}
	}
}

export function downloadFloodUI(): void {
	mkdirSync(ASSETS_DIR, { recursive: true });

	if (existsSync(`${ASSETS_DIR}/flood-for-transmission`)) {
		debug("Flood UI already downloaded");
		return;
	}

	log("Downloading Flood UI...");
	execSync(
		`curl -sL https://github.com/johman10/flood-for-transmission/releases/latest/download/flood-for-transmission.tar.gz | tar xz -C "${ASSETS_DIR}"`,
	);
	log("Flood UI downloaded");
}
