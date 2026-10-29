import { describe, expect, it } from "vitest";
import { applyOrder, moveTo } from "./tileOrder";

describe("applyOrder", () => {
	it("keeps the API's order when nothing was saved", () => {
		expect(applyOrder(["a", "b", "c"], [])).toEqual(["a", "b", "c"]);
	});

	it("follows the saved order", () => {
		expect(applyOrder(["a", "b", "c"], ["c", "a", "b"])).toEqual([
			"c",
			"a",
			"b",
		]);
	});

	it("puts a service the saved order does not know at the end", () => {
		expect(applyOrder(["a", "new", "b"], ["b", "a"])).toEqual([
			"b",
			"a",
			"new",
		]);
	});

	it("skips a saved service that is no longer installed", () => {
		expect(applyOrder(["a", "c"], ["c", "gone", "a"])).toEqual(["c", "a"]);
	});

	it("never shows a service twice, whatever was saved", () => {
		expect(applyOrder(["a", "b"], ["b", "b", "a"])).toEqual(["b", "a"]);
	});
});

describe("moveTo", () => {
	it("moves a service to the given position", () => {
		expect(moveTo(["a", "b", "c", "d"], "a", 2)).toEqual(["b", "c", "a", "d"]);
		expect(moveTo(["a", "b", "c", "d"], "d", 0)).toEqual(["d", "a", "b", "c"]);
	});

	it("clamps a position past either end", () => {
		expect(moveTo(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
		expect(moveTo(["a", "b", "c"], "b", 9)).toEqual(["a", "c", "b"]);
	});

	it("leaves the order alone for an id it does not hold", () => {
		expect(moveTo(["a", "b"], "x", 0)).toEqual(["a", "b"]);
	});
});
