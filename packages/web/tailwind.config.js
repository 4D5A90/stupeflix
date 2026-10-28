/** A channel triple from `index.css`, so `bg-fg/10` keeps working. */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
	content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
	theme: {
		// Semantic tokens: the values live in `src/index.css`, per mode, so a
		// class names a role (`bg-card`, `text-muted`) and never a colour.
		//
		// Not under `extend`: replacing the palette is what retires the stock
		// greys — `bg-gray-800` no longer generates anything, so it cannot creep
		// back. White stays for text on the accent fill, which is white in both
		// modes.
		colors: {
			transparent: "transparent",
			current: "currentColor",
			inherit: "inherit",
			white: "#ffffff",
			page: token("page"),
			card: token("card"),
			raised: token("raised"),
			fg: token("fg"),
			muted: token("muted"),
			faint: token("faint"),
			track: token("track"),
			field: token("field"),
			ok: token("ok"),
			warn: token("warn"),
			fail: { DEFAULT: token("fail"), bg: "var(--fail-bg)" },
			link: { DEFAULT: token("link"), hover: token("link-hover") },
			accent: {
				DEFAULT: token("accent"),
				hover: "var(--accent-hover)",
				pressed: "var(--accent-pressed)",
			},
			stage: token("stage"),
			line: "var(--line)",
			secondary: "var(--secondary)",
		},
		extend: {
			fontFamily: {
				sans: [
					"Inter Tight",
					"Helvetica Neue",
					"Segoe UI",
					"Roboto",
					"sans-serif",
				],
				mono: ["JetBrains Mono", "ui-monospace", "Menlo", "monospace"],
			},
			borderColor: { DEFAULT: "var(--line)" },
		},
	},
	plugins: [],
};
