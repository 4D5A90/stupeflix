import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { debug, log } from "./logger.js";

export function cleanConfigs(configPath: string): void {
	const dirs = [
		"mediamanager",
		"transmission",
		"qbittorrent",
		"jellyfin",
		"plex",
		"emby",
	];
	log("Cleaning config directories...");

	for (const dir of dirs) {
		const path = `${configPath}/${dir}`;
		if (existsSync(path)) {
			debug(`Removing ${path}`);
			rmSync(path, { recursive: true, force: true });
		}
	}
}

export function downloadFloodUI(): void {
	mkdirSync("./assets", { recursive: true });

	if (existsSync("./assets/flood-for-transmission")) {
		debug("Flood UI already downloaded");
		return;
	}

	log("Downloading Flood UI...");
	execSync(
		"curl -sL https://github.com/johman10/flood-for-transmission/releases/latest/download/flood-for-transmission.tar.gz | tar xz -C ./assets",
	);
	log("Flood UI downloaded");
}
