import { chownSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { PGID, PUID } from "./env.js";

/**
 * `mkdir -p`, then hand the directory to PUID:PGID.
 *
 * The API runs as root in its image, so whatever it creates is root's — and a
 * service container runs as PUID, which then cannot write there: Radarr refuses
 * `/media/Movies` as a root folder with "not writable by user 'abc'". The
 * directories it created on the way are handed over too, and the target is
 * handed over even when it already existed, so an install that predates this
 * heals on the next run. Never recursive: what sits inside is the user's.
 *
 * Only root can give a directory away; anyone else created it as themselves,
 * which is what PUID defaults to outside a container.
 */
export function mkdirOwned(path: string): void {
	const first = mkdirSync(path, { recursive: true });
	if (process.getuid?.() !== 0) return;
	const uid = Number(PUID);
	const gid = Number(PGID);
	for (let dir = path; ; dir = dirname(dir)) {
		chownSync(dir, uid, gid);
		if (!first || dir === first || dir === dirname(dir)) break;
	}
}
