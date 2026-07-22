import { build } from "esbuild";

await build({
	entryPoints: ["src/index.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	outfile: "dist/index.js",
	// Bundled CJS dependencies (yaml, sql.js) still use require/__dirname at
	// runtime, none of which exist in an ESM bundle.
	banner: {
		js: [
			"import { createRequire as __createRequire } from 'node:module';",
			"import { fileURLToPath as __fileURLToPath } from 'node:url';",
			"import { dirname as __pathDirname } from 'node:path';",
			"const require = __createRequire(import.meta.url);",
			"const __filename = __fileURLToPath(import.meta.url);",
			"const __dirname = __pathDirname(__filename);",
		].join("\n"),
	},
});
