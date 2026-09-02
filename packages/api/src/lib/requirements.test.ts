import { describe, expect, it } from "vitest";
import { checkRequirements, unmetRequirements } from "./requirements.js";
import type { Requirement, ServiceTemplate } from "./service-registry.js";

function svc(
	id: string,
	category: string,
	deps: { requires?: Requirement[]; recommends?: Requirement[] } = {},
): ServiceTemplate {
	return {
		id,
		name: id,
		description: "",
		category,
		defaultEnabled: false,
		container: id,
		compose: {},
		credentials: [],
		setup: [],
		...deps,
	};
}

const TEMPLATES = [
	svc("jellyfin", "mediaServer"),
	svc("plex", "mediaServer"),
	svc("qbittorrent", "torrentClient"),
	svc("transmission", "torrentClient"),
	svc("prowlarr", "indexer"),
	svc("sonarr", "mediaManager", {
		requires: [{ category: "torrentClient", reason: "hands off downloads" }],
		recommends: [{ category: "indexer" }],
	}),
	// Declares the one it was actually built against
	svc("locked", "mediaManager", {
		requires: [
			{
				category: "torrentClient",
				supports: ["qbittorrent"],
				reason: "hands off downloads",
			},
		],
	}),
	svc("seerr", "requests", {
		requires: [{ category: "mediaServer" }],
	}),
];

describe("checkRequirements", () => {
	it("says nothing about a service that is not enabled", () => {
		expect(checkRequirements(TEMPLATES, ["jellyfin"])).toEqual({
			missing: [],
			warnings: [],
		});
	});

	it("reports a blocking need, with the reason the template gave", () => {
		const { missing } = checkRequirements(TEMPLATES, ["sonarr"]);
		expect(missing).toEqual([
			{
				service: "sonarr",
				category: "torrentClient",
				reason: "hands off downloads",
			},
		]);
	});

	it("keeps a recommendation out of the blocking list", () => {
		const { missing, warnings } = checkRequirements(TEMPLATES, [
			"sonarr",
			"qbittorrent",
		]);
		expect(missing).toEqual([]);
		expect(warnings).toEqual([{ service: "sonarr", category: "indexer" }]);
	});

	it("is satisfied by any service of the category, not by a named one", () => {
		for (const server of ["jellyfin", "plex"]) {
			expect(checkRequirements(TEMPLATES, ["seerr", server]).missing).toEqual(
				[],
			);
		}
	});

	it("counts every unmet need of every enabled service", () => {
		const { missing, warnings } = checkRequirements(TEMPLATES, [
			"sonarr",
			"seerr",
		]);
		expect(missing.map((m) => m.category)).toEqual([
			"torrentClient",
			"mediaServer",
		]);
		expect(warnings).toHaveLength(1);
	});
});

describe("supports", () => {
	it("is met by a member the template was built against", () => {
		expect(
			checkRequirements(TEMPLATES, ["locked", "qbittorrent"]).missing,
		).toEqual([]);
	});

	it("is not met by another member of the same category", () => {
		const { missing } = checkRequirements(TEMPLATES, [
			"locked",
			"transmission",
		]);
		expect(missing).toHaveLength(1);
		expect(missing[0].category).toBe("torrentClient");
	});

	it("says which one it wants and which one is there", () => {
		const { missing } = checkRequirements(TEMPLATES, [
			"locked",
			"transmission",
		]);
		// Named, not id'd — and the one we want is by definition not installed
		expect(missing[0].reason).toContain("qbittorrent");
		expect(missing[0].reason).toContain("transmission");
		expect(missing[0].reason).not.toContain("undefined");
	});

	it("falls back to the template's own words when the category is empty", () => {
		const { missing } = checkRequirements(TEMPLATES, ["locked"]);
		expect(missing[0].reason).toBe("hands off downloads");
	});

	it("leaves a requirement without it satisfied by any member", () => {
		expect(
			checkRequirements(TEMPLATES, ["sonarr", "transmission"]).missing,
		).toEqual([]);
	});
});

describe("unmetRequirements", () => {
	it("answers for the service being added, ignoring what others lack", () => {
		expect(unmetRequirements(TEMPLATES, ["sonarr"], svcOf("seerr"))).toEqual([
			{ service: "seerr", category: "mediaServer", reason: undefined },
		]);
	});

	it("is empty once the category is covered", () => {
		expect(unmetRequirements(TEMPLATES, ["jellyfin"], svcOf("seerr"))).toEqual(
			[],
		);
	});

	it("does not need the service to be enabled yet", () => {
		expect(unmetRequirements(TEMPLATES, [], svcOf("jellyfin"))).toEqual([]);
	});
});

function svcOf(id: string): ServiceTemplate {
	const tpl = TEMPLATES.find((t) => t.id === id);
	if (!tpl) throw new Error(`no fixture "${id}"`);
	return tpl;
}
