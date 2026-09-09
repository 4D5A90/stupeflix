import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fakeDb } from "../test/fake-db.js";
import { DB_PATH } from "./env.js";
import {
	DB_LABEL,
	INSTANCE_LABEL,
	conflictMessage,
	foreignOwner,
	getInstanceId,
	instanceLabels,
	parseOwners,
	stampInstance,
} from "./instance.js";

describe("getInstanceId", () => {
	it("mints one and keeps it", () => {
		const db = fakeDb();
		const first = getInstanceId(db);
		expect(getInstanceId(db)).toBe(first);
		expect(db.get("instance.id")).toBe(first);
	});

	it("never replaces a stored one", () => {
		const db = fakeDb({ "instance.id": "already-here" });
		expect(getInstanceId(db)).toBe("already-here");
	});
});

describe("stampInstance", () => {
	const labels = { [INSTANCE_LABEL]: "abc", [DB_LABEL]: "/srv/x.db" };

	it("labels a service that declares none", () => {
		expect(stampInstance({ image: "nginx" }, labels)).toEqual({
			image: "nginx",
			labels,
		});
	});

	it("keeps the labels a template declared, in map form", () => {
		const out = stampInstance(
			{ image: "nginx", labels: { "traefik.enable": "true" } },
			labels,
		) as { labels: Record<string, string> };
		expect(out.labels).toEqual({ "traefik.enable": "true", ...labels });
	});

	it("keeps them in list form, and appends ours the same way", () => {
		const out = stampInstance(
			{ image: "nginx", labels: ["traefik.enable=true"] },
			labels,
		) as { labels: string[] };
		expect(out.labels).toEqual([
			"traefik.enable=true",
			`${INSTANCE_LABEL}=abc`,
			`${DB_LABEL}=/srv/x.db`,
		]);
	});

	it("leaves anything that is not a service alone", () => {
		expect(stampInstance(null, labels)).toBeNull();
	});
});

describe("instanceLabels", () => {
	it("carries the id and the absolute database path", () => {
		const db = fakeDb({ "instance.id": "abc" });
		expect(instanceLabels(db)).toEqual({
			[INSTANCE_LABEL]: "abc",
			[DB_LABEL]: resolve(DB_PATH),
		});
	});
});

describe("parseOwners", () => {
	it("reads one container per line, splitting on the first separator", () => {
		expect(parseOwners("abc|/srv/a.db\ndef|/srv/b.db\n")).toEqual([
			{ instance: "abc", db: "/srv/a.db" },
			{ instance: "def", db: "/srv/b.db" },
		]);
	});

	it("keeps a path containing the separator whole", () => {
		expect(parseOwners("abc|/srv/od|d/a.db")).toEqual([
			{ instance: "abc", db: "/srv/od|d/a.db" },
		]);
	});

	it("reads a container from before the labels existed as unowned", () => {
		expect(parseOwners("|\n")).toEqual([{ instance: "", db: "" }]);
	});
});

describe("foreignOwner", () => {
	it("finds nothing when every container is ours", () => {
		const rows = [{ instance: "abc", db: "/srv/a.db" }];
		expect(foreignOwner(rows, "abc")).toBeUndefined();
	});

	// Refusing them would break every stack installed before this check existed;
	// the next `up` stamps them.
	it("adopts containers that carry no label", () => {
		expect(foreignOwner([{ instance: "", db: "" }], "abc")).toBeUndefined();
	});

	it("reports the container another database created", () => {
		const rows = [
			{ instance: "abc", db: "/srv/a.db" },
			{ instance: "def", db: "/srv/b.db" },
		];
		expect(foreignOwner(rows, "abc")).toEqual({
			instance: "def",
			db: "/srv/b.db",
		});
	});
});

describe("conflictMessage", () => {
	it("names both databases, so the two can be told apart", () => {
		const message = conflictMessage({ instance: "def", db: "/srv/b.db" });
		expect(message).toContain("/srv/b.db");
		expect(message).toContain(resolve(DB_PATH));
	});

	it("stays readable when the other instance labelled no path", () => {
		expect(conflictMessage({ instance: "def", db: "" })).not.toContain(
			"undefined",
		);
	});
});
