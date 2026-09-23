import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chowned: string[] = [];
vi.mock("node:fs", async (orig) => ({
	...(await orig<typeof import("node:fs")>()),
	chownSync: (path: string) => chowned.push(path),
}));

const { mkdirOwned } = await import("./owned-dir.js");

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "stupeflix-own-"));
	chowned.length = 0;
});

afterEach(() => {
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

describe("mkdirOwned", () => {
	it("hands every directory it created to PUID, and nothing above", () => {
		vi.spyOn(process, "getuid").mockReturnValue(0);
		mkdirOwned(join(root, "media/Movies"));
		expect(statSync(join(root, "media/Movies")).isDirectory()).toBe(true);
		expect(chowned).toEqual([join(root, "media/Movies"), join(root, "media")]);
	});

	it("hands over a directory that already existed, so an old install heals", () => {
		vi.spyOn(process, "getuid").mockReturnValue(0);
		mkdirSync(join(root, "Movies"));
		mkdirOwned(join(root, "Movies"));
		expect(chowned).toEqual([join(root, "Movies")]);
	});

	it("leaves ownership alone when not root", () => {
		vi.spyOn(process, "getuid").mockReturnValue(501);
		mkdirOwned(join(root, "Movies"));
		expect(statSync(join(root, "Movies")).isDirectory()).toBe(true);
		expect(chowned).toEqual([]);
	});
});
