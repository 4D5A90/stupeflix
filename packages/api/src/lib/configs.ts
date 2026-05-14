import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import type { Db } from "../db.js";
import { debug, error, log } from "./logger.js";

const MEDIAMANAGER_CONFIG_URL =
	"https://raw.githubusercontent.com/maxdorninger/MediaManager/master/config.example.toml";

const MEDIA_DIRS = ["Movies", "TvShows"];

export function generateConfigs(db: Db): void {
	const s = db.all();
	const configPath = s["paths.config"] as string;
	const mediaPath = s["paths.media"] as string;

	createMediaDirs(mediaPath);

	if (s["services.transmission.enabled"]) {
		configureTransmission(db, configPath);
	}

	if (s["services.qbittorrent.enabled"]) {
		configureQBittorrent(db, configPath);
	}

	if (s["services.mediamanager.enabled"]) {
		configureMediaManager(db, configPath);
	}
}

function createMediaDirs(mediaPath: string): void {
	for (const dir of MEDIA_DIRS) {
		mkdirSync(`${mediaPath}/${dir}`, { recursive: true });
	}
	log("Media directories created");
}

function configureTransmission(db: Db, configPath: string): void {
	log("Configuring Transmission...");

	const configDir = `${configPath}/transmission`;
	const settingsFile = `${configDir}/settings.json`;

	mkdirSync(configDir, { recursive: true });

	if (existsSync(settingsFile)) {
		debug("Transmission settings.json already exists, skipping");
		return;
	}

	const s = db.all();
	const settings = {
		"download-dir": "/downloads",
		"incomplete-dir": "/downloads/incomplete",
		"incomplete-dir-enabled": true,
		"rpc-authentication-required": true,
		"rpc-username": s["credentials.transmission.user"],
		"rpc-password": s["credentials.transmission.pass"],
		"rpc-port": 9091,
		"rpc-whitelist-enabled": false,
		"peer-port": 49153,
	};

	writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
	log("Transmission configured");
}

function configureQBittorrent(db: Db, configPath: string): void {
	log("Configuring qBittorrent...");

	const configDir = `${configPath}/qbittorrent/qBittorrent`;
	const cacheDir = `${configPath}/qbittorrent/.cache/qBittorrent`;
	const configFile = `${configDir}/qBittorrent.conf`;

	mkdirSync(configDir, { recursive: true });
	mkdirSync(cacheDir, { recursive: true });

	if (existsSync(configFile)) {
		debug("qBittorrent config already exists, skipping");
		return;
	}

	const s = db.all();
	const config = [
		"[Preferences]",
		`WebUI\\Username=${s["credentials.qbittorrent.user"]}`,
		`WebUI\\Port=8080`,
		"",
		"[BitTorrent]",
		"Session\\DefaultSavePath=/downloads",
	].join("\n");

	writeFileSync(configFile, config);
	log("qBittorrent configured with Movies/TvShows categories");
}

function configureMediaManager(db: Db, configPath: string): void {
	log("Configuring MediaManager...");

	const configDir = `${configPath}/mediamanager/config`;
	const configFile = `${configDir}/config.toml`;

	mkdirSync(configDir, { recursive: true });

	if (!existsSync(configFile)) {
		log("Downloading MediaManager config template...");
		execSync(`curl -sL "${MEDIAMANAGER_CONFIG_URL}" -o "${configFile}"`);
	}

	let tokenSecret = db.get("internal.mediamanager.token_secret") as string;
	if (!tokenSecret) {
		tokenSecret = randomUUID() + randomUUID();
		db.set("internal.mediamanager.token_secret", tokenSecret);
		debug("Generated new token secret");
	}

	const s = db.all();
	const transmissionUser = s["credentials.transmission.user"] as string;
	const transmissionPass = s["credentials.transmission.pass"] as string;
	const adminEmail = s["credentials.mediamanager.email"] as string;

	debug("MediaManager config values", {
		adminEmail,
		transmissionUser,
		transmissionPass: transmissionPass ? "***" : "(empty)",
	});

	const sedScript = [
		`s|^token_secret = .*|token_secret = "${tokenSecret}"|`,
		`s|^admin_emails = .*|admin_emails = ["${adminEmail}"]|`,
		`/\\[torrents.transmission\\]/,/^\\[/ { s|enabled = false|enabled = true|; s|username = "admin"|username = "${transmissionUser}"|; s|password = "admin"|password = "${transmissionPass}"|; s|host = "localhost"|host = "transmission"|; s|https_enabled = true|https_enabled = false|; }`,
	].join("; ");

	execSync(`sed -i '' '${sedScript}' "${configFile}"`);
	log("MediaManager configured");
}

async function waitForMediaManager(maxWait = 60000): Promise<boolean> {
	log("Waiting for MediaManager API...");
	const start = Date.now();
	while (Date.now() - start < maxWait) {
		try {
			const res = await fetch("http://localhost:8000/api/v1/health");
			if (res.ok) {
				log("MediaManager API ready");
				return true;
			}
		} catch {
			debug("MediaManager not ready yet");
		}
		await new Promise((r) => setTimeout(r, 2000));
	}
	error("MediaManager API timeout");
	return false;
}

export async function registerMediaManagerUser(db: Db): Promise<boolean> {
	if (!db.get("services.mediamanager.enabled")) {
		return false;
	}

	const email = db.get("credentials.mediamanager.email") as string;
	const password = db.get("credentials.mediamanager.pass") as string;

	if (!email || !password) {
		error("MediaManager credentials not set");
		return false;
	}

	if (!(await waitForMediaManager())) {
		return false;
	}

	log("Registering MediaManager user...");

	try {
		const res = await fetch("http://localhost:8000/api/v1/auth/register", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email,
				password,
				is_active: null,
				is_superuser: null,
				is_verified: null,
			}),
		});

		const data = await res.json();
		debug("MediaManager register response", { status: res.status, data });

		if (res.ok) {
			log("MediaManager user registered");
			return true;
		}

		if (res.status === 400 && data?.detail === "REGISTER_USER_ALREADY_EXISTS") {
			log("MediaManager user already exists");
			return true;
		}

		error("Failed to register MediaManager user", data);
		return false;
	} catch (e) {
		error("Failed to register MediaManager user", e);
		return false;
	}
}
