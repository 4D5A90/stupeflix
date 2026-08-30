import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { Db } from "../db.js";
import { configuredDb } from "../test/fake-db.js";
import { generateCompose } from "./compose.js";
import {
	affectedServices,
	applyNetworkTopology,
	resolveNetworkTopology,
} from "./network.js";
import { loadTemplates } from "./service-registry.js";
import type { ServiceTemplate } from "./service-registry.js";

const FIXTURES = fileURLToPath(
	new URL("../test/fixtures-network", import.meta.url),
);

beforeAll(() => loadTemplates(FIXTURES));

interface ComposeFile {
	services: Record<string, Record<string, unknown>>;
}

/** `extra` switches services on; everything defaults to off in these fixtures. */
function render(...enabled: string[]): ComposeFile {
	const db: Db = configuredDb(
		Object.fromEntries(enabled.map((id) => [`services.${id}.enabled`, true])),
	);
	return parse(generateCompose(db)) as ComposeFile;
}

describe("no provider enabled", () => {
	/**
	 * The property that makes this design safe to ship: a template asking to be
	 * tunnelled is unchanged when nothing answers, so there is no second variant
	 * of its compose block to maintain.
	 */
	it("leaves the joiner exactly as it was declared", () => {
		const { services } = render("client");
		expect(services.client.ports).toEqual(["9000:9000", "9001:9001/udp"]);
		expect(services.client.network_mode).toBeUndefined();
		expect(services.client.depends_on).toBeUndefined();
	});

	it("addresses it by its own name", () => {
		const { services } = render("client", "peer");
		expect(services.peer.environment).toEqual([
			"CLIENT_URL=http://client:9000",
		]);
	});
});

describe("provider enabled", () => {
	it("moves the joiner's ports onto the provider", () => {
		const { services } = render("vpn", "client");
		expect(services.client.ports).toBeUndefined();
		expect(services.vpn.ports).toEqual([
			"8888:8888",
			"9000:9000",
			"9001:9001/udp",
		]);
	});

	it("puts the joiner inside the provider's namespace", () => {
		const { services } = render("vpn", "client");
		expect(services.client.network_mode).toBe("service:vpn");
	});

	/** Starting before the tunnel is up would leak in the clear. */
	it("waits for the provider to be healthy, not merely started", () => {
		const { services } = render("vpn", "client");
		expect(services.client.depends_on).toEqual({
			vpn: { condition: "service_healthy" },
		});
	});

	it("leaves a service that asked for nothing alone", () => {
		const { services } = render("vpn", "client", "peer");
		expect(services.peer.network_mode).toBeUndefined();
		expect(services.peer.ports).toBeUndefined();
	});

	/**
	 * The failure this whole `{{host.<id>}}` indirection exists to prevent: a
	 * joined container has no DNS name of its own, so a peer addressing it by
	 * name would silently lose it.
	 */
	it("redirects peers to the provider, since the joiner loses its own name", () => {
		const { services } = render("vpn", "client", "peer");
		expect(services.peer.environment).toEqual(["CLIENT_URL=http://vpn:9000"]);
	});
});

describe("rejections", () => {
	const topology = { joins: new Map([["client", "vpn"]]) };
	const joined = (extra: Record<string, unknown>) => ({
		vpn: {} as Record<string, unknown>,
		client: extra,
	});

	/** Docker only catches these at `up`, so the engine has to say it first. */
	it("refuses every setting that belongs to the namespace owner", () => {
		for (const key of [
			"networks",
			"hostname",
			"links",
			"dns",
			"dns_search",
			"extra_hosts",
		]) {
			expect(() =>
				applyNetworkTopology(joined({ [key]: "whatever" }), topology),
			).toThrow(new RegExp(`cannot declare "${key}"`));
		}
	});

	it("drops `expose`, a no-op annotation rather than a namespace setting", () => {
		const services = joined({ expose: ["8080"] });
		applyNetworkTopology(services, topology);
		expect("expose" in services.client).toBe(false);
	});

	it("refuses two providers of the same capability", () => {
		const provider = (id: string): ServiceTemplate =>
			({
				id,
				container: id,
				network: { provides: "vpn" },
			}) as ServiceTemplate;
		expect(() =>
			resolveNetworkTopology([provider("a"), provider("b")]),
		).toThrow(/Two enabled services provide/);
	});
});

/**
 * The failure this exists to prevent: `up -d gluetun` alone, while qBittorrent
 * still holds the ports the new definition just moved onto Gluetun.
 * "Bind for 0.0.0.0:6881 failed: port is already allocated".
 */
describe("affectedServices", () => {
	const topology = { joins: new Map([["client", "vpn"]]) };

	it("brings the joiners up with the provider, and stops them first", () => {
		expect(affectedServices("vpn", topology)).toEqual({
			all: ["vpn", "client"],
			joiners: ["client"],
		});
	});

	it("brings the provider up with a joiner, since the ports move either way", () => {
		expect(affectedServices("client", topology)).toEqual({
			all: ["client", "vpn"],
			joiners: ["client"],
		});
	});

	it("leaves an unrelated service on its own, as before", () => {
		expect(affectedServices("peer", topology)).toEqual({
			all: ["peer"],
			joiners: [],
		});
	});

	it("does nothing special with no tunnel in play", () => {
		expect(affectedServices("client", { joins: new Map() })).toEqual({
			all: ["client"],
			joiners: [],
		});
	});
});
