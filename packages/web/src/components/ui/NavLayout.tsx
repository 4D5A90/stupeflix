import type { ReactNode } from "react";

/**
 * The account-page layout Settings and the wizard share: a title and a column
 * of pages on the left, the current page on white cards to its right. The two
 * wrap into one column at phone width, nav first.
 */
export function NavLayout({
	title,
	label,
	nav,
	children,
	live = false,
}: {
	title: string;
	/** The nav's accessible name — "Settings", "Setup steps". */
	label: string;
	nav: ReactNode;
	children: ReactNode;
	/** For a page whose content changes on its own, like a running setup. */
	live?: boolean;
}) {
	return (
		<div className="mx-auto flex max-w-[1200px] flex-wrap items-start gap-12 px-[4%] pt-12">
			<nav
				aria-label={label}
				className="flex flex-[1_1_220px] flex-col gap-0.5"
			>
				<h1 className="mb-4 text-[40px] font-extrabold leading-[1.15]">
					{title}
				</h1>
				{nav}
			</nav>
			<main
				aria-live={live ? "polite" : undefined}
				className="flex min-w-0 flex-[999_1_680px] flex-col gap-5 md:pt-16"
			>
				{children}
			</main>
		</div>
	);
}

/** One entry of that nav; the selected one sits on a card. */
export function navItemClass(current: boolean): string {
	return `flex min-h-12 w-full items-center gap-3 rounded px-3.5 text-left text-base transition-colors disabled:cursor-default disabled:text-muted ${
		current
			? "bg-card font-bold"
			: "hover:bg-fg/[0.04] disabled:hover:bg-transparent"
	}`;
}
