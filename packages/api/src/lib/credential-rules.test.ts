import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { template } from "../test/helpers.js";
import { credentialProblems, fieldProblem } from "./credential-rules.js";
import { loadTemplates } from "./service-registry.js";
import type { CredentialField, ServiceTemplate } from "./service-registry.js";

const FIXTURES = fileURLToPath(new URL("../test/fixtures", import.meta.url));

beforeAll(() => loadTemplates(FIXTURES));

function field(extra: Partial<CredentialField> = {}): CredentialField {
	return { key: "pass", type: "password", label: "Password", ...extra };
}

describe("fieldProblem", () => {
	it("lets an empty value through, the way the wizard does", () => {
		// `required:` polices presence; `rules:` polices shape. Otherwise every
		// untouched field would carry an error before it was ever filled.
		expect(fieldProblem(field({ rules: { minLength: 6 } }), "")).toBe(null);
	});

	it("applies the three rules a template can declare", () => {
		const rules = { minLength: 6, maxLength: 8, pattern: "^[a-z]+$" };
		expect(fieldProblem(field({ rules }), "abcdef")).toBe(null);
		expect(fieldProblem(field({ rules }), "abc")).toMatch(/at least 6/);
		expect(fieldProblem(field({ rules }), "abcdefghi")).toMatch(/at most 8/);
		expect(fieldProblem(field({ rules }), "ABCDEF")).toMatch(/expected format/);
	});

	it("prefers the template's own wording", () => {
		const rules = { minLength: 6, message: "Six, please" };
		expect(fieldProblem(field({ rules }), "abc")).toBe("Six, please");
	});

	it("bounds a field that declares no rules at all", () => {
		expect(fieldProblem(field(), "x".repeat(513))).toMatch(/at most 512/);
		expect(fieldProblem(field(), "x".repeat(512))).toBe(null);
	});

	it("holds a select to the options its template offers", () => {
		const select = field({
			key: "provider",
			type: "select",
			options: [{ value: "mullvad", label: "Mullvad" }],
		});
		expect(fieldProblem(select, "mullvad")).toBe(null);
		expect(fieldProblem(select, "anything")).toMatch(/offered options/);
	});
});

describe("credentialProblems", () => {
	function withFields(fields: CredentialField[]): ServiceTemplate {
		return { ...template("alpha"), credentials: fields };
	}

	it("passes what the template declares", () => {
		const tpl = withFields([field({ key: "user", type: "text" })]);
		expect(credentialProblems(tpl, { user: "admin" })).toEqual([]);
	});

	it("refuses a key the template does not declare", () => {
		// The key is concatenated into `credentials.<id>.<key>`, so an accepted
		// one writes a setting nothing reads and no screen shows.
		const tpl = withFields([field({ key: "user", type: "text" })]);
		expect(credentialProblems(tpl, { "../../evil": "x" })).toEqual([
			"alpha.../../evil is not a field this service declares",
		]);
	});

	it("refuses a value that is not text", () => {
		const tpl = withFields([field({ key: "user", type: "text" })]);
		expect(credentialProblems(tpl, { user: { nested: true } })).toEqual([
			"alpha.user must be text",
		]);
	});
});

describe("the shipped qBittorrent rules", () => {
	beforeAll(() =>
		loadTemplates(
			fileURLToPath(new URL("../../../../templates", import.meta.url)),
		),
	);

	it("refuses the username that injects an [AutoRun] command", () => {
		const tpl = template("qbittorrent");
		const problems = credentialProblems(tpl, {
			user: "admin\n[AutoRun]\nenabled=true\nprogram=/bin/sh -c 'id > /tmp/x'",
		});
		expect(problems).toHaveLength(1);
	});

	it("refuses the password that rewrites the setPreferences body", () => {
		const tpl = template("qbittorrent");
		expect(
			credentialProblems(tpl, { pass: 'a","web_ui_username":"root' }),
		).toHaveLength(1);
	});

	it("still takes an ordinary generated password", () => {
		const tpl = template("qbittorrent");
		expect(
			credentialProblems(tpl, { user: "admin", pass: "k3np7rqx2m9wtzbc4vjh" }),
		).toEqual([]);
	});
});
