/**
 * One SVG per service in `src/icons/`, named after its id — adding a
 * service is dropping `<id>.svg` beside the others, and nothing here changes.
 * The file that used to hold every glyph inline is the one place the frontend
 * named services, which is exactly what the templates directory exists to avoid.
 *
 * `?raw` + `eager` inlines them at build time: no request, no flash, and the
 * glyph keeps `currentColor`, so a tint still reaches it. Author an icon with
 * `fill="currentColor"` or `stroke="currentColor"` and it takes the tile's hue.
 */
const files = import.meta.glob("../../icons/*.svg", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

const icons: Record<string, string> = Object.fromEntries(
	Object.entries(files).map(([path, svg]) => [
		path.split("/").pop()?.replace(".svg", "") ?? path,
		svg,
	]),
);

/** A service whose icon has not been drawn yet still gets a readable tile. */
export function ServiceIcon({ id }: { id: string }) {
	return (
		<span
			aria-hidden="true"
			className="w-5 h-5 [&>svg]:w-full [&>svg]:h-full"
			// The markup is a build-time constant read from this repo's own assets
			// directory: no runtime input reaches it, and inlining is what keeps
			// the glyph on `currentColor` so the tile's tint applies.
			// biome-ignore lint/security/noDangerouslySetInnerHtml: build-time repo asset, no user input
			dangerouslySetInnerHTML={{ __html: icons[id] ?? icons._default }}
		/>
	);
}

/**
 * Each service's tint, picked rather than derived.
 *
 * Hashing an id into ten hue slots looked principled and was not: eleven
 * services over ten slots collide by construction — Jellyfin, Seerr and the
 * runner all landed on 108°, qBittorrent, Radarr and Tracearr all on 288°. No
 * amount of saturation fixes two tiles that are the same colour.
 *
 * So the hues are chosen, with two rules. Services next to each other in a list
 * — the wizard's matrix and the dashboard are both in alphabetical order — are
 * far apart on the wheel. And `tone` splits the pairs that still land close:
 * `bright` and `deep` differ in saturation and lightness, so a 30° gap reads as
 * two colours instead of one. Brand hues are honoured where they were free
 * (Jellyfin violet, qBittorrent azure, Radarr gold) and dropped where they were
 * not — the icon carries the identity, the tile only has to separate.
 *
 * No hue is reserved: state is a labelled badge elsewhere on the card, so a
 * green or red tile behind a glyph is not mistaken for one.
 */
const TINTS: Record<string, { hue: number; tone: "bright" | "deep" }> = {
	gluetun: { hue: 340, tone: "bright" },
	jellyfin: { hue: 262, tone: "deep" },
	joal: { hue: 65, tone: "bright" },
	plex: { hue: 25, tone: "deep" },
	prowlarr: { hue: 130, tone: "bright" },
	qbittorrent: { hue: 210, tone: "deep" },
	radarr: { hue: 45, tone: "bright" },
	seerr: { hue: 315, tone: "deep" },
	sonarr: { hue: 180, tone: "bright" },
	tracearr: { hue: 95, tone: "deep" },
};

const HUE_SLOTS = 10;

/** For an id no tint names — a template added without one, so it still reads. */
function hueOf(id: string): number {
	let hash = 0;
	// Math.imul, not `*`: the multiplier overflows double precision, so a plain
	// multiply silently returns a different hash than the arithmetic implies.
	for (let i = 0; i < id.length; i++)
		hash = (Math.imul(hash, 2654435761) + id.charCodeAt(i)) >>> 0;
	return (hash % HUE_SLOTS) * (360 / HUE_SLOTS);
}

/**
 * A full-colour logo brings its own palette, and a hue behind it fights it —
 * Prowlarr's orange on a green tile reads as a mistake. Detected rather than
 * declared: an icon that never says `currentColor` cannot take a tint, so it
 * gets a neutral tile and speaks for itself.
 */
const NEUTRAL_TILE = {
	backgroundColor: "rgb(255 255 255 / 0.06)",
	color: "inherit",
};

export function serviceTint(id: string): {
	backgroundColor: string;
	color: string;
} {
	const svg = icons[id];
	if (svg && !svg.includes("currentColor")) return NEUTRAL_TILE;

	const tint = TINTS[id] ?? { hue: hueOf(id), tone: "bright" as const };
	// The glyph carries the hue; the square behind it only separates the tile
	// from the card, so it stays well below the glyph's contrast.
	return tint.tone === "deep"
		? {
				backgroundColor: `hsl(${tint.hue} 58% 46% / 0.22)`,
				color: `hsl(${tint.hue} 56% 64%)`,
			}
		: {
				backgroundColor: `hsl(${tint.hue} 70% 60% / 0.18)`,
				color: `hsl(${tint.hue} 74% 72%)`,
			};
}
