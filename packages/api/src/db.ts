import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import initSqlJs, { type Database } from "sql.js";

const DEFAULTS: Record<string, unknown> = {
	"paths.config": "",
	"paths.media": "",
	"paths.torrents": "",
	"credentials.transmission.user": "admin",
	"credentials.transmission.pass": "",
	"credentials.mediamanager.email": "",
	"credentials.mediamanager.pass": "",
	"credentials.qbittorrent.user": "admin",
	"credentials.qbittorrent.pass": "",
	"services.mediamanager.enabled": true,
	"services.jellyfin.enabled": true,
	"services.plex.enabled": false,
	"services.emby.enabled": false,
	"services.transmission.enabled": true,
	"services.qbittorrent.enabled": false,
	"setup.completed": false,
};

export interface Db {
	get: (key: string) => unknown;
	set: (key: string, value: unknown) => void;
	all: () => Record<string, unknown>;
	delete: (key: string) => void;
}

export async function initDb(dbPath = "./data/stupeflix.db"): Promise<Db> {
	const SQL = await initSqlJs();

	mkdirSync(dirname(dbPath), { recursive: true });

	let db: Database;
	if (existsSync(dbPath)) {
		const buffer = readFileSync(dbPath);
		db = new SQL.Database(buffer);
	} else {
		db = new SQL.Database();
	}

	const save = () => writeFileSync(dbPath, Buffer.from(db.export()));

	db.run(
		readFileSync(
			new URL("../migrations/001_init.sql", import.meta.url),
			"utf-8",
		),
	);

	for (const [key, value] of Object.entries(DEFAULTS)) {
		db.run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [
			key,
			JSON.stringify(value),
		]);
	}
	save();

	return {
		get: (key: string) => {
			const stmt = db.prepare("SELECT value FROM settings WHERE key = ?");
			stmt.bind([key]);
			if (stmt.step()) {
				const row = stmt.getAsObject() as { value: string };
				stmt.free();
				return JSON.parse(row.value);
			}
			stmt.free();
			return null;
		},
		set: (key: string, value: unknown) => {
			db.run(
				"INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch())",
				[key, JSON.stringify(value)],
			);
			save();
		},
		all: () => {
			const results: Record<string, unknown> = {};
			const stmt = db.prepare("SELECT key, value FROM settings");
			while (stmt.step()) {
				const row = stmt.getAsObject() as { key: string; value: string };
				results[row.key] = JSON.parse(row.value);
			}
			stmt.free();
			return results;
		},
		delete: (key: string) => {
			db.run("DELETE FROM settings WHERE key = ?", [key]);
			save();
		},
	};
}
