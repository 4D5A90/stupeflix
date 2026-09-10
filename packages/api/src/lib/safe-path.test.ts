import { describe, expect, it } from "vitest";
import {
	isUnderRoot,
	libraryNameProblem,
	pathProblem,
	underRoot,
} from "./safe-path.js";

describe("underRoot", () => {
	it("joins the ordinary case", () => {
		expect(underRoot("/srv/config", "jellyfin", "config.xml")).toBe(
			"/srv/config/jellyfin/config.xml",
		);
		expect(underRoot("/srv/config")).toBe("/srv/config");
	});

	it("refuses a tail that climbs out", () => {
		for (const tail of ["../etc", "../../../root/.ssh", "jellyfin/../../etc"]) {
			expect(() => underRoot("/srv/config", tail), tail).toThrow(/is outside/);
		}
	});

	it("refuses an absolute tail, which join would have honoured", () => {
		expect(() => underRoot("/srv/config", "/etc/passwd")).toThrow(/is outside/);
	});

	it("does not mistake a sibling with a shared prefix for a child", () => {
		expect(isUnderRoot("/srv/config", "/srv/config-backup")).toBe(false);
		expect(isUnderRoot("/srv/config", "/srv/config/jellyfin")).toBe(true);
	});
});

describe("pathProblem", () => {
	it("takes an absolute path", () => {
		expect(pathProblem("/srv/media")).toBe(null);
	});

	it("refuses what would make a reset destroy the host", () => {
		expect(pathProblem("/")).toBe("must not be the filesystem root");
		expect(pathProblem("/srv/../..")).toBe('must not contain ".."');
		expect(pathProblem("config")).toBe("must be an absolute path");
		expect(pathProblem("")).toBe("must not be empty");
		expect(pathProblem(42)).toBe("must not be empty");
	});
});

describe("libraryNameProblem", () => {
	it("takes a name", () => {
		expect(libraryNameProblem("TV Shows")).toBe(null);
	});

	it("refuses one that is a path", () => {
		expect(libraryNameProblem("../../etc")).toBe(
			"must not contain a path separator",
		);
		expect(libraryNameProblem("..")).toBe("must be a name, not a traversal");
	});
});
