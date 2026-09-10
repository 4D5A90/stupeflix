import { describe, expect, it } from "vitest";
import { composeArgs } from "./docker-cli.js";
import { COMPOSE_FILE, COMPOSE_PROJECT } from "./env.js";

describe("composeArgs", () => {
	it("pins the project and the generated file", () => {
		expect(composeArgs(["up", "-d"])).toEqual([
			"compose",
			"-p",
			COMPOSE_PROJECT,
			"-f",
			COMPOSE_FILE,
			"up",
			"-d",
		]);
	});

	it("keeps a hostile argument as one argument", () => {
		// The old builder concatenated into a string handed to /bin/sh, where this
		// value ended the command and started another. As an argv element it is
		// just a container name docker will not find.
		const evil = "jellyfin; docker run -v /:/host --privileged alpine";
		expect(composeArgs(["logs", evil]).at(-1)).toBe(evil);
		expect(composeArgs(["logs", evil])).toHaveLength(
			composeArgs(["logs", "jellyfin"]).length,
		);
	});
});
