import { describe, expect, it } from "vitest";
import { SERVICE_HOST } from "./env.js";
import { isOwnHost, serviceUrl } from "./service-url.js";

const CONTAINERS = ["jellyfin", "gluetun"];

describe("serviceUrl", () => {
	it("rewrites loopback to the host publishing the container ports", () => {
		expect(serviceUrl("http://localhost:8096/System/Info", CONTAINERS)).toBe(
			`http://${SERVICE_HOST}:8096/System/Info`,
		);
		expect(serviceUrl("http://127.0.0.1:8096/", CONTAINERS)).toBe(
			`http://${SERVICE_HOST}:8096/`,
		);
	});

	it("takes a container this install declares", () => {
		expect(serviceUrl("http://jellyfin:8096/api", CONTAINERS)).toBe(
			"http://jellyfin:8096/api",
		);
	});

	it("refuses a host that is neither", () => {
		// The finding this function exists for: a template naming the cloud
		// metadata endpoint had its body handed back by GET /services/:name/info.
		expect(() =>
			serviceUrl("http://169.254.169.254/latest/meta-data/", CONTAINERS),
		).toThrow(/not a service this install runs/);
	});

	it("is not fooled by a hostname that merely starts with localhost", () => {
		// The old rewrite was an unanchored substring replace, so these two were
		// silently mangled or passed straight through to a domain someone else owns.
		for (const url of [
			"http://localhost.evil.com/",
			"http://127.0.0.1.evil.com/",
			"http://evil.com/?x=://localhost",
		]) {
			expect(() => serviceUrl(url, CONTAINERS), url).toThrow();
		}
	});

	it("is not fooled by userinfo standing in for a host", () => {
		expect(() =>
			serviceUrl("http://127.0.0.1:8096@evil.com/", CONTAINERS),
		).toThrow(/not a service this install runs/);
	});

	it("refuses a scheme no service answers on", () => {
		for (const url of ["file:///etc/passwd", "gopher://localhost/"]) {
			expect(() => serviceUrl(url, CONTAINERS), url).toThrow(/is not a scheme/);
		}
	});

	it("rewrites the IPv6 loopback literal, brackets and all", () => {
		// `new URL("http://[::1]/").hostname` keeps the brackets, unlike every
		// other host it returns — so the set has to carry them too.
		expect(serviceUrl("http://[::1]:8096/System", CONTAINERS)).toBe(
			`http://${SERVICE_HOST}:8096/System`,
		);
	});

	it("passes an empty URL through, for the steps that have none", () => {
		expect(serviceUrl("", CONTAINERS)).toBe("");
	});
});

describe("isOwnHost", () => {
	it("recognises the service itself, however it is addressed", () => {
		expect(isOwnHost("http://qbittorrent:8080/api", "qbittorrent")).toBe(true);
		expect(isOwnHost("http://localhost:8080/api", "qbittorrent")).toBe(true);
		expect(isOwnHost(`http://${SERVICE_HOST}:8080/api`, "qbittorrent")).toBe(
			true,
		);
	});

	it("does not recognise a peer, which must not receive its session", () => {
		expect(isOwnHost("http://sonarr:8989/api", "qbittorrent")).toBe(false);
	});
});
