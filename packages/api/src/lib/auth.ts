import { randomBytes } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import type { Db } from "../db.js";
import { TOKEN } from "./env.js";

/**
 * The only routes served without a token: the healthcheck, which Docker polls
 * from outside the app and has no way to carry one (`Dockerfile`, HEALTHCHECK).
 * It answers nothing an attacker does not already know from the port being open.
 *
 * Both spellings, because the router is mounted twice — at the root for
 * `pnpm dev`, where Vite strips the `/api` prefix, and under `/api` in the
 * packaged image.
 */
const OPEN_PATHS = new Set(["/health", "/api/health"]);

/** Where a minted token is kept. Refused by `GET /settings`, like every secret. */
export const TOKEN_KEY = "auth.token";

/**
 * What `hono/bearer-auth` will parse out of an `Authorization` header — base64
 * and base64url, and nothing else.
 *
 * A token outside it is rejected by the *parser*, so the correct token answers
 * 400 and the operator is locked out by their own configuration, with a status
 * code that says nothing about why. Caught here instead: once, at boot, loudly.
 * `openssl rand -base64 32` produces a conforming one.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9._~+/-]+=*$/;

/** Minted tokens are 32 bytes; a hand-written one guards the same door. */
const MIN_LENGTH = 16;

export function tokenProblem(token: string): string | null {
	if (token.length < MIN_LENGTH) {
		return `must be at least ${MIN_LENGTH} characters`;
	}
	if (!TOKEN_SHAPE.test(token)) {
		return "may only contain letters, digits and . _ ~ + / - =";
	}
	return null;
}

/**
 * The token this instance answers to.
 *
 * Kept in the database rather than minted per process: one that changed on every
 * restart would sign the browser out each time, and teach the operator to paste
 * whatever token a screen asks for — which is the habit a phishing page needs.
 * `STUPEFLIX_TOKEN` overrides it for a deployment that manages its own secrets.
 */
export function accessToken(db: Db): string {
	if (TOKEN) {
		const problem = tokenProblem(TOKEN);
		// Refusing to start beats starting unreachable: this runs before serve().
		if (problem) throw new Error(`STUPEFLIX_TOKEN ${problem}`);
		return TOKEN;
	}
	const stored = db.get(TOKEN_KEY) as string | null;
	if (stored) return stored;
	const minted = randomBytes(32).toString("base64url");
	db.set(TOKEN_KEY, minted);
	return minted;
}

/**
 * Refuses every request that does not carry the token, except `OPEN_PATHS`.
 *
 * A bearer token rather than a session cookie, and the difference is not
 * cosmetic: a cross-origin page cannot set an `Authorization` header without a
 * preflight the API never grants, so CSRF has no purchase here. A cookie would
 * travel on its own and would need guarding separately.
 *
 * Mount it on the `api` router, never on the outer app — that one also serves
 * the built wizard, and locking the static files would lock the very screen
 * that asks for the token.
 */
export function tokenGate(token: string): MiddlewareHandler {
	const bearer = bearerAuth({
		token,
		// The repo answers `{ error }` everywhere; the web client reads that key.
		noAuthenticationHeader: { message: { error: "Unauthorized" } },
		invalidAuthenticationHeader: { message: { error: "Unauthorized" } },
		invalidToken: { message: { error: "Unauthorized" } },
	});
	return (c, next) => (OPEN_PATHS.has(c.req.path) ? next() : bearer(c, next));
}
