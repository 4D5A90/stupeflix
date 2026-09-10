import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { initDb } from "./db.js";
import { accessToken } from "./lib/auth.js";
import { HOST, PORT, STACKS_DIR, TEMPLATES_DIR, TOKEN } from "./lib/env.js";
import { getTemplateDefaults, loadTemplates } from "./lib/service-registry.js";
import { loadStacks } from "./lib/stacks.js";

loadTemplates(
	TEMPLATES_DIR ?? resolve(import.meta.dirname, "../../../templates"),
);
loadStacks(STACKS_DIR ?? resolve(import.meta.dirname, "../../../stacks"));

const db = await initDb(getTemplateDefaults());

// If the server restarted mid-setup or mid-install, unlock the state
if (db.get("setup.global") === "in_progress") {
	db.set("setup.global", "failed");
	db.set("setup.error", "Server was restarted during setup");
}

serve({ fetch: createApp(db).fetch, port: PORT, hostname: HOST });
console.log(`Stupeflix running on http://localhost:${PORT}`);
console.log(
	TOKEN
		? "Access token: pinned by STUPEFLIX_TOKEN"
		: `Access token: ${accessToken(db)}`,
);
