import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
	it("reads the two columns docker prints", () => {
		const out = "jellyfin\trunning\nqbittorrent\texited\n";
		expect([...parseStatuses(out)]).toEqual([
			["jellyfin", "running"],
			["qbittorrent", "exited"],
		]);
	});

	it("ignores a blank or half-written line rather than storing it", () => {
		expect([
			...parseStatuses("\n\njellyfin\n\tstopped\nplex\trunning"),
		]).toEqual([["plex", "running"]]);
	});
});

describe("containerStatus", () => {
	it("reads a container's state from the single ps", () => {
		docker.mockReturnValue("jellyfin\trunning\n");
		expect(containerStatus("jellyfin")).toBe("running");
	});

	it("reads an unlisted container as absent", () => {
		docker.mockReturnValue("jellyfin\trunning\n");
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
			docker.mockReturnValue("jellyfin\trunning\n");
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
