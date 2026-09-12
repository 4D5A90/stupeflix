import { afterEach, describe, expect, it, vi } from "vitest";
import {
	containerHealth,
	containerStatus,
	containerStatuses,
	forgetContainerStatuses,
	parseStatuses,
} from "./container-status.js";
import { runDockerSync } from "./docker-cli.js";

vi.mock("./docker-cli.js", () => ({ runDockerSync: vi.fn() }));
const docker = vi.mocked(runDockerSync);

afterEach(() => {
	forgetContainerStatuses();
	vi.clearAllMocks();
});

describe("parseStatuses", () => {
	it("reads the columns docker prints", () => {
		const out =
			"jellyfin\trunning\tUp 2 hours\nqbittorrent\texited\tExited (0) 3 minutes ago\n";
		expect([...parseStatuses(out)]).toEqual([
			["jellyfin", { state: "running" }],
			["qbittorrent", { state: "exited" }],
		]);
	});

	it("ignores a blank or half-written line rather than storing it", () => {
		expect([
			...parseStatuses("\n\njellyfin\n\tstopped\nplex\trunning\tUp 1 hour"),
		]).toEqual([["plex", { state: "running" }]]);
	});

	// Three distinct markers, and the common case is none of them: a container
	// with no `healthcheck:` has no health to report, which is not the same as
	// being unhealthy.
	it("reads the health marker out of the status prose", () => {
		const out = [
			"gluetun\trunning\tUp 2 hours (healthy)",
			"sonarr\trunning\tUp 3 minutes (unhealthy)",
			"radarr\trunning\tUp 5 seconds (health: starting)",
			"jellyfin\trunning\tUp 2 hours",
		].join("\n");
		expect([...parseStatuses(out)]).toEqual([
			["gluetun", { state: "running", health: "healthy" }],
			["sonarr", { state: "running", health: "unhealthy" }],
			["radarr", { state: "running", health: "starting" }],
			["jellyfin", { state: "running" }],
		]);
	});

	// Docker keeps the last probe in `.Status` for a stopped container. Reporting
	// it would call a container that is not running unhealthy, which is a
	// different problem than the one the badge is for.
	it("drops the health of a container that is not running", () => {
		expect([
			...parseStatuses(
				"gluetun\texited\tExited (137) 2 minutes ago (unhealthy)",
			),
		]).toEqual([["gluetun", { state: "exited" }]]);
	});
});

describe("containerStatus", () => {
	it("reads a container's state from the single ps", () => {
		docker.mockReturnValue("jellyfin\trunning\tUp 2 hours\n");
		expect(containerStatus("jellyfin")).toBe("running");
	});

	it("keeps state and health on separate axes", () => {
		docker.mockReturnValue("gluetun\trunning\tUp 2 hours (unhealthy)\n");
		expect(containerStatus("gluetun")).toBe("running");
		expect(containerHealth("gluetun")).toBe("unhealthy");
	});

	it("reports no health for a container that declares no healthcheck", () => {
		docker.mockReturnValue("jellyfin\trunning\tUp 2 hours\n");
		expect(containerHealth("jellyfin")).toBeUndefined();
	});

	it("reads an unlisted container as absent", () => {
		docker.mockReturnValue("jellyfin\trunning\tUp 2 hours\n");
		expect(containerStatus("plex")).toBe("not_found");
	});

	it("reads everything as absent when docker cannot be reached", () => {
		// One `docker inspect` per template used to fail per container; this must
		// degrade the same way rather than take the dashboard down with it.
		docker.mockImplementation(() => {
			throw new Error("Cannot connect to the Docker daemon");
		});
		expect(containerStatus("jellyfin")).toBe("not_found");
	});

	it("asks docker once for a burst, and again once the memo is stale", () => {
		vi.useFakeTimers();
		try {
			docker.mockReturnValue("jellyfin\trunning\tUp 2 hours\n");
			containerStatuses();
			containerStatuses();
			containerStatuses();
			expect(docker).toHaveBeenCalledTimes(1);
			vi.advanceTimersByTime(1500);
			containerStatuses();
			expect(docker).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});
});
