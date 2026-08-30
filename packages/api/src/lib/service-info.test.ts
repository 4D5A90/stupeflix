import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { configuredDb } from "../test/fake-db.js";
import { readInfoField, readServiceInfo } from "./service-info.js";
import { loadTemplates } from "./service-registry.js";
import type { InfoField, ServiceTemplate } from "./service-registry.js";

const FIXTURES = fileURLToPath(new URL("../test/fixtures", import.meta.url));

beforeAll(() => loadTemplates(FIXTURES));

afterEach(() => vi.unstubAllGlobals());

const tpl = { id: "alpha" } as ServiceTemplate;
const field = (extra: Partial<InfoField> = {}): InfoField => ({
	name: "ip",
	label: "Exit IP",
	url: "http://service.test/v1/publicip/ip",
	...extra,
});

function answers(body: unknown, init: ResponseInit = {}) {
	vi.stubGlobal(
		"fetch",
		vi.fn(
			async () =>
				new Response(typeof body === "string" ? body : JSON.stringify(body), {
					status: 200,
					...init,
				}),
		),
	);
}

describe("readInfoField", () => {
	it("pulls the value at the declared path", async () => {
		answers({ public_ip: "185.65.1.2", city: "Malmö" });
		await expect(
			readInfoField(configuredDb(), tpl, field({ extract: "public_ip" })),
		).resolves.toBe("185.65.1.2");
	});

	it("walks a nested path", async () => {
		answers({ data: { version: "10.9.11" } });
		await expect(
			readInfoField(configuredDb(), tpl, field({ extract: "data.version" })),
		).resolves.toBe("10.9.11");
	});

	it("uses the whole body when no path is declared", async () => {
		answers("  10.9.11\n");
		await expect(readInfoField(configuredDb(), tpl, field())).resolves.toBe(
			"10.9.11",
		);
	});

	it("renders a number as text, since the card only displays it", async () => {
		answers({ count: 42 });
		await expect(
			readInfoField(configuredDb(), tpl, field({ extract: "count" })),
		).resolves.toBe("42");
	});

	/**
	 * Every failure reads as unknown rather than as an error: a stopped service
	 * must leave a dash on its card, not make the card look broken.
	 */
	it("reads as unknown when the path misses", async () => {
		answers({ public_ip: "185.65.1.2" });
		await expect(
			readInfoField(configuredDb(), tpl, field({ extract: "nope.deeper" })),
		).resolves.toBeNull();
	});

	it("reads as unknown when the value is not a scalar", async () => {
		answers({ nested: { a: 1 } });
		await expect(
			readInfoField(configuredDb(), tpl, field({ extract: "nested" })),
		).resolves.toBeNull();
	});

	it("reads as unknown on a failing status", async () => {
		answers({}, { status: 503 });
		await expect(
			readInfoField(configuredDb(), tpl, field()),
		).resolves.toBeNull();
	});

	it("reads as unknown when the service cannot be reached", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("connection refused");
			}),
		);
		await expect(
			readInfoField(configuredDb(), tpl, field()),
		).resolves.toBeNull();
	});
});

describe("readServiceInfo", () => {
	it("returns nothing at all for a template declaring none", async () => {
		await expect(readServiceInfo(configuredDb(), tpl)).resolves.toEqual({});
	});

	it("keeps the fields independent, so one failure does not hide the others", async () => {
		let call = 0;
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				call++;
				if (call === 1) throw new Error("down");
				return new Response(JSON.stringify({ v: "ok" }));
			}),
		);
		const withTwo = {
			id: "alpha",
			info: [field({ name: "first" }), field({ name: "second", extract: "v" })],
		} as ServiceTemplate;

		await expect(readServiceInfo(configuredDb(), withTwo)).resolves.toEqual({
			first: null,
			second: "ok",
		});
	});
});
