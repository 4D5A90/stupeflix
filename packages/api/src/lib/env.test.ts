import { describe, expect, it } from "vitest";
import { publicHostProblem } from "./env.js";

describe("publicHostProblem", () => {
	it("accepts a LAN address, a name and a bracketed IPv6", () => {
		for (const host of ["192.168.1.17", "media-box.local", "[fd00::17]"])
			expect(publicHostProblem(host), host).toBe(null);
	});

	// Each of these would be spliced into `http://<host>:<port>` and silently
	// produce a link that goes nowhere.
	it("refuses a scheme, a port, a path or a space", () => {
		for (const host of [
			"http://192.168.1.17",
			"192.168.1.17:3000",
			"192.168.1.17/",
			"media box",
		])
			expect(publicHostProblem(host), host).toMatch(/host/);
	});
});
