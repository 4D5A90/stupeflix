import type { ReactNode } from "react";

/**
 * One glyph per service category, drawn beside the category's first row in the
 * Services step. Keyed by the `category` a template declares, so a template
 * never names an icon here — an unknown category falls back rather than
 * breaking the row.
 */
const icons: Record<string, ReactNode> = {
	mediaServer: <path d="M9 7l8 5-8 5V7z" />,
	requests: <path d="M4 7h16v10H4zM4 7l8 6 8-6" />,
	mediaManager: (
		<path d="M4 6h16v12H4zM9 6v12M15 6v12M4 10h5M4 14h5M15 10h5M15 14h5" />
	),
	indexer: <path d="M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4" />,
	torrentClient: <path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />,
	vpn: <path d="M12 3l7 3v6c0 4-3 7.5-7 9-4-1.5-7-5-7-9V6l7-3z" />,
	seeder: (
		<path d="M4 12a8 8 0 0113.7-5.7M20 12a8 8 0 01-13.7 5.7M18 4v3.5h-3.5M6 20v-3.5h3.5" />
	),
};

/** Shown for a category this file does not know yet. */
const defaultIcon = <path d="M4 6h16v12H4z" />;

export function CategoryIcon({
	category,
	className,
}: {
	category: string;
	className?: string;
}) {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.7}
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			{icons[category] ?? defaultIcon}
		</svg>
	);
}
