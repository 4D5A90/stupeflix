import { describe, expect, it } from "vitest";
import { validateTemplate } from "./template-schema.js";

/** The smallest thing the engine accepts, to vary one field at a time. */
function template(extra: Record<string, unknown> = {}) {
	return {
		id: "demo",
		name: "Demo",
		description: "A service",
		category: "indexer",
		defaultEnabled: false,
		container: "demo",
		compose: { demo: { image: "example/demo", container_name: "demo" } },
		setup: [],
		...extra,
	};
}

describe("shape", () => {
	it("accepts the minimum", () => {
		expect(validateTemplate(template())).toEqual([]);
	});

	it("refuses what is not a mapping, rather than throwing", () => {
		// An empty `.yml` parses to null. It used to stop the server booting for
		// good, since loadTemplates runs before serve().
		for (const value of [null, "", 3, []]) {
			expect(validateTemplate(value)).toEqual(["not a mapping"]);
		}
	});

	it("names every missing required field", () => {
		expect(validateTemplate({}).length).toBeGreaterThan(5);
		expect(validateTemplate(template({ name: undefined }))).toContain(
			"name is required",
		);
	});

	it("refuses a key it does not know", () => {
		expect(validateTemplate(template({ exec: "rm -rf /" }))).toContain(
			"exec is not a template field",
		);
	});

	it("refuses an id or container that is not a name", () => {
		for (const id of ["demo; whoami", "../demo", "-demo", ""]) {
			expect(validateTemplate(template({ id })).join()).toMatch(/^id must/);
		}
	});
});

describe("paths a template hands to join()", () => {
	it("refuses a reset directory that climbs out", () => {
		// This one is the sharpest edge in the engine: `dropConfig` empties every
		// reset directory with rmSync({ recursive: true, force: true }).
		expect(validateTemplate(template({ reset: { dirs: ["../.."] } }))).toEqual([
			'reset.dirs[0] must not climb out with "..", got "../.."',
		]);
	});

	it("refuses an absolute dirs entry", () => {
		expect(validateTemplate(template({ dirs: ["/etc"] }))).toEqual([
			'dirs[0] must be relative, got "/etc"',
		]);
	});

	it("refuses a config_file writing outside paths.config", () => {
		const setup = [
			{
				name: "conf",
				label: "Write config",
				type: "config_file",
				file: "../../../root/.ssh/authorized_keys",
				content: "ssh-rsa …",
			},
		];
		expect(validateTemplate(template({ setup })).join()).toContain(
			"setup[0].file must not climb out",
		);
	});

	it("caps a regex, which is compiled and run on service output", () => {
		const setup = [
			{
				name: "grab",
				label: "Grab",
				type: "store",
				store: {
					from: "logs",
					container: "demo",
					regex: `(${"a+".repeat(120)})`,
					as: "x",
				},
			},
		];
		expect(validateTemplate(template({ setup })).join()).toContain(
			"setup[0].store.regex is longer than 200",
		);
	});

	it("refuses a step type the runner does not implement", () => {
		const setup = [{ name: "x", label: "X", type: "shell" }];
		expect(validateTemplate(template({ setup })).join()).toContain(
			'setup[0].type "shell" is not a step type',
		);
	});

	it("checks an action the same way as a setup step", () => {
		const actions = { scan: { name: "scan", label: "Scan", type: "shell" } };
		expect(validateTemplate(template({ actions })).join()).toContain(
			"actions.scan.type",
		);
	});
});

describe("the compose guard", () => {
	function withService(service: Record<string, unknown>) {
		return template({
			compose: { demo: { image: "example/demo", ...service } },
		});
	}

	it("refuses the keys that hand over the host", () => {
		for (const key of [
			"privileged",
			"pid",
			"ipc",
			"uts",
			"userns_mode",
			"security_opt",
			"cgroup_parent",
			"sysctls",
			"network_mode",
		]) {
			expect(validateTemplate(withService({ [key]: "host" }))).toEqual([
				`compose.demo.${key} is not allowed`,
			]);
		}
	});

	it("lets gluetun raise its tunnel", () => {
		expect(
			validateTemplate(
				withService({
					cap_add: ["NET_ADMIN"],
					devices: ["/dev/net/tun:/dev/net/tun"],
				}),
			),
		).toEqual([]);
	});

	it("refuses a capability or a device that is not that", () => {
		expect(validateTemplate(withService({ cap_add: ["SYS_ADMIN"] }))).toEqual([
			"compose.demo.cap_add: SYS_ADMIN is not allowed",
		]);
		expect(validateTemplate(withService({ devices: ["/dev/sda"] }))).toEqual([
			"compose.demo.devices: /dev/sda is not allowed",
		]);
	});

	it("refuses a bind mount that is not under a wizard path", () => {
		for (const mount of [
			"/:/host",
			"/var/run/docker.sock:/sock",
			"/etc:/etc",
		]) {
			expect(
				validateTemplate(withService({ volumes: [mount] })).join(),
			).toMatch(/is neither a declared volume nor under/);
		}
	});

	it("takes the three roots and a declared named volume", () => {
		const value = template({
			volumes: { demo_data: null },
			compose: {
				demo: {
					image: "example/demo",
					volumes: [
						"{{paths.config}}/demo:/config",
						"{{paths.media}}:/media",
						"{{paths.torrents}}:/downloads",
						"demo_data:/data",
					],
				},
			},
		});
		expect(validateTemplate(value)).toEqual([]);
	});

	it("refuses a bind mount that climbs back out of its root", () => {
		// A prefix is not containment, and this is the bypass the first version
		// shipped with: the string starts under {{paths.media}} and resolves at
		// the Docker socket, which compose hands to the daemon verbatim.
		for (const root of ["config", "media", "torrents"]) {
			const mount = `{{paths.${root}}}/../../../../var/run/docker.sock:/sock`;
			expect(
				validateTemplate(withService({ volumes: [mount] })).join(),
				mount,
			).toMatch(/climbs back out of/);
		}
		expect(
			validateTemplate(
				withService({ volumes: ["{{paths.config}}/../../../:/host"] }),
			).join(),
		).toMatch(/climbs back out of/);
	});

	it("checks the long syntax too", () => {
		const bind = { type: "bind", source: "/var/run/docker.sock", target: "/s" };
		expect(validateTemplate(withService({ volumes: [bind] })).join()).toMatch(
			/is neither a declared volume/,
		);
	});

	it("refuses a named volume nobody declared", () => {
		expect(
			validateTemplate(withService({ volumes: ["orphan:/data"] })).join(),
		).toMatch(/"orphan" is neither/);
	});
});

describe("a validator that must never throw", () => {
	/*
	 * Its answer becomes a 400 with the reasons in it. An exception instead is a
	 * 500 that says nothing — and on the load path, a server that will not boot.
	 * The upload route hands it whatever YAML parsed to.
	 */
	const HOSTILE: unknown[] = [
		null,
		undefined,
		0,
		"",
		[],
		[1, 2],
		{ compose: { a: { cap_add: {} } } },
		{ compose: { a: { devices: "not a list" } } },
		{ compose: { a: { volumes: {} } } },
		{ compose: "no" },
		{ compose: { a: null } },
		{ setup: "no" },
		{ setup: [null, 3, "x"] },
		{ actions: [] },
		{ actions: { a: 3 } },
		{ credentials: "no" },
		{ credentials: [null] },
		{ reset: "no" },
		{ reset: { dirs: "no" } },
		{ dirs: {} },
		{ info: "no" },
		{ notes: [3] },
		{ requires: "no" },
		{ generate: [7] },
		{ network: [] },
		{ volumes: [] },
		{ id: 3, container: false, port: "80", webUiPath: 9 },
	];

	for (const [i, value] of HOSTILE.entries()) {
		it(`answers rather than throwing (${i})`, () => {
			const problems = validateTemplate(value);
			expect(Array.isArray(problems)).toBe(true);
			expect(problems.length).toBeGreaterThan(0);
		});
	}
});

describe("names that reach an allowlist", () => {
	it("refuses a container that is really a host", () => {
		// `containerNames()` feeds lib/service-url.ts. A dotted name there is a
		// host the engine would then agree to fetch.
		for (const container of [
			"169.254.169.254",
			"metadata.example.com",
			"evil.com",
		]) {
			expect(
				validateTemplate(template({ container })).join(),
				container,
			).toMatch(/container must match/);
		}
	});

	it("still takes the names the shipped templates use", () => {
		for (const container of [
			"gluetun",
			"qbittorrent",
			"tracearr-db",
			"joal_1",
		]) {
			expect(validateTemplate(template({ container })), container).toEqual([]);
		}
	});
});
