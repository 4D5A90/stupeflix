import { exec } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { Db } from "../db.js";
import { COMPOSE_PROJECT, DB_PATH } from "./env.js";

const execAsync = promisify(exec);

/**
 * Who created a container, written where Docker can be asked.
 *
 * The compose project is fixed on purpose, so that the packaged image and the
 * dev server pointed at the same `data/` own the same containers. Ownership is
 * therefore the *database*, not the working directory — and nothing in Docker
 * records which one that is. These two labels are that missing fact: the id
 * decides, the path is only there to name the other instance in a message.
 */
export const INSTANCE_LABEL = "com.stupeflix.instance";
export const DB_LABEL = "com.stupeflix.db";

/** A path may contain anything but a newline, so split on the first one only. */
const SEPARATOR = "|";

export interface ContainerOwner {
	instance: string;
	db: string;
}

/** Minted once and kept: it identifies the database, not the process. */
export function getInstanceId(db: Db): string {
	const stored = db.get("instance.id") as string | null;
	if (stored) return stored;
	const id = randomUUID();
	db.set("instance.id", id);
	return id;
}

export function instanceLabels(db: Db): Record<string, string> {
	return {
		[INSTANCE_LABEL]: getInstanceId(db),
		[DB_LABEL]: resolve(DB_PATH),
	};
}

/**
 * Adds the labels to one generated compose service. A template is free to carry
 * labels of its own — in either form compose accepts — and keeps them: dropping
 * a `traefik.*` rule to make room for bookkeeping would be a poor trade.
 */
export function stampInstance(
	service: unknown,
	labels: Record<string, string>,
): unknown {
	if (service === null || typeof service !== "object") return service;
	const own = (service as Record<string, unknown>).labels;
	const merged = Array.isArray(own)
		? [...own, ...Object.entries(labels).map(([k, v]) => `${k}=${v}`)]
		: { ...((own as Record<string, string> | undefined) ?? {}), ...labels };
	return { ...(service as Record<string, unknown>), labels: merged };
}

export function parseOwners(stdout: string): ContainerOwner[] {
	return stdout
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => {
			const at = line.indexOf(SEPARATOR);
			return at === -1
				? { instance: line, db: "" }
				: { instance: line.slice(0, at), db: line.slice(at + 1) };
		});
}

/**
 * The first container this database did not create, if there is one.
 *
 * An unlabelled container predates this check and is adopted — refusing it
 * would strand every stack installed before the label existed, and the next
 * `up` stamps it anyway.
 */
export function foreignOwner(
	owners: ContainerOwner[],
	mine: string,
): ContainerOwner | undefined {
	return owners.find((o) => o.instance !== "" && o.instance !== mine);
}

export function conflictMessage(foreign: ContainerOwner): string {
	const other = foreign.db || "another location";
	return [
		"Another Stupeflix instance owns these containers.",
		`They were created from ${other}, and this one runs on ${resolve(DB_PATH)}.`,
		"Point both at the same data directory, or stop the other instance",
		"before continuing.",
	].join(" ");
}

function ownersCommand(): string {
	const format = `{{.Label "${INSTANCE_LABEL}"}}${SEPARATOR}{{.Label "${DB_LABEL}"}}`;
	const filter = `label=com.docker.compose.project=${COMPOSE_PROJECT}`;
	return `docker ps -a --filter ${filter} --format '${format}'`;
}

/**
 * Why this install, reconfigure or removal must be refused, or null when the
 * project is ours to drive.
 *
 * A docker that cannot be reached answers neither way: stay silent and let the
 * command that follows fail with its own error, which is the one worth reading.
 */
export async function ownershipConflict(db: Db): Promise<string | null> {
	let owners: ContainerOwner[];
	try {
		const { stdout } = await execAsync(ownersCommand());
		owners = parseOwners(stdout);
	} catch {
		return null;
	}
	const foreign = foreignOwner(owners, getInstanceId(db));
	return foreign ? conflictMessage(foreign) : null;
}
