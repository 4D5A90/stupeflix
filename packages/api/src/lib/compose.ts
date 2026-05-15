import { stringify } from "yaml";
import type { Db } from "../db.js";

const PUID = process.getuid?.() ?? 1000;
const PGID = process.getgid?.() ?? 1000;

export function generateCompose(db: Db): string {
	const s = db.all();
	const services: Record<string, object> = {};

	if (s["services.transmission.enabled"]) {
		services.transmission = {
			image: "linuxserver/transmission:latest",
			container_name: "transmission",
			environment: [
				`PUID=${PUID}`,
				`PGID=${PGID}`,
				"TZ=Europe/Paris",
				`USER=${s["credentials.transmission.user"]}`,
				`PASS=${s["credentials.transmission.pass"]}`,
				"TRANSMISSION_WEB_HOME=/ui",
			],
			volumes: [
				`${s["paths.config"]}/transmission:/config`,
				`${s["paths.torrents"]}:/downloads`,
				`${s["paths.media"]}:/media`,
				"./assets/flood-for-transmission:/ui",
			],
			ports: ["9091:9091", "49153:49153", "49153:49153/udp"],
			restart: "unless-stopped",
		};
	}

	if (s["services.qbittorrent.enabled"]) {
		services.qbittorrent = {
			image: "linuxserver/qbittorrent:latest",
			container_name: "qbittorrent",
			environment: [
				`PUID=${PUID}`,
				`PGID=${PGID}`,
				"TZ=Europe/Paris",
				"WEBUI_PORT=8080",
			],
			volumes: [
				`${s["paths.config"]}/qbittorrent:/config`,
				`${s["paths.torrents"]}:/downloads`,
				`${s["paths.media"]}:/media`,
			],
			ports: ["8080:8080", "6881:6881", "6881:6881/udp"],
			restart: "unless-stopped",
		};
	}

	if (s["services.jellyfin.enabled"]) {
		services.jellyfin = {
			image: "linuxserver/jellyfin:latest",
			container_name: "jellyfin",
			environment: [`PUID=${PUID}`, `PGID=${PGID}`, "TZ=Europe/Paris"],
			volumes: [
				`${s["paths.config"]}/jellyfin:/config`,
				`${s["paths.media"]}:/media`,
			],
			ports: ["8096:8096"],
			restart: "unless-stopped",
		};
	}

	if (s["services.plex.enabled"]) {
		const plexClaim = s["credentials.plex.claim"] as string;
		services.plex = {
			image: "linuxserver/plex:latest",
			container_name: "plex",
			environment: [
				`PUID=${PUID}`,
				`PGID=${PGID}`,
				"TZ=Europe/Paris",
				"VERSION=docker",
				...(plexClaim ? [`PLEX_CLAIM=${plexClaim}`] : []),
			],
			volumes: [
				`${s["paths.config"]}/plex:/config`,
				`${s["paths.media"]}:/media`,
			],
			ports: ["32400:32400"],
			restart: "unless-stopped",
		};
	}

	if (s["services.emby.enabled"]) {
		services.emby = {
			image: "linuxserver/emby:latest",
			container_name: "emby",
			environment: [`PUID=${PUID}`, `PGID=${PGID}`, "TZ=Europe/Paris"],
			volumes: [
				`${s["paths.config"]}/emby:/config`,
				`${s["paths.media"]}:/media`,
			],
			ports: ["8096:8096"],
			restart: "unless-stopped",
		};
	}

	if (s["services.mediamanager.enabled"]) {
		services.db = {
			image: "postgres:17",
			container_name: "mediamanager_postgres",
			environment: [
				"POSTGRES_USER=MediaManager",
				"POSTGRES_PASSWORD=MediaManager",
				"POSTGRES_DB=MediaManager",
			],
			volumes: [
				`${s["paths.config"]}/mediamanager/postgres:/var/lib/postgresql/data`,
			],
			restart: "unless-stopped",
			healthcheck: {
				test: [
					"CMD-SHELL",
					"pg_isready -d $${POSTGRES_DB} -U $${POSTGRES_USER}",
				],
				interval: "10s",
				timeout: "5s",
				retries: 5,
			},
		};

		services.mediamanager = {
			image: "quay.io/maxdorninger/mediamanager:latest",
			container_name: "mediamanager_server",
			environment: ["CONFIG_DIR=/app/config", "TZ=Europe/Paris"],
			volumes: [
				`${s["paths.config"]}/mediamanager/config:/app/config`,
				`${s["paths.media"]}:/data`,
			],
			ports: ["8000:8000"],
			restart: "unless-stopped",
			depends_on: {
				db: { condition: "service_healthy" },
			},
		};
	}

	return stringify({ services });
}
