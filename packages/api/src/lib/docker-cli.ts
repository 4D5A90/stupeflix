import { COMPOSE_FILE, COMPOSE_PROJECT } from "./env.js";

/**
 * Builds a `docker compose` command pinned to the generated file and project name,
 * so it behaves the same whatever the working directory is.
 */
export function compose(args: string): string {
	const project = COMPOSE_PROJECT ? ` -p ${COMPOSE_PROJECT}` : "";
	return `docker compose${project} -f "${COMPOSE_FILE}" ${args}`;
}
