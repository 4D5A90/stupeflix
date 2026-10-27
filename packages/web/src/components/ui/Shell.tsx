import type { ReactNode } from "react";
import { buttonClass } from "./Button";

/**
 * Every screen's frame: the black top bar, then the screen on its own mode's
 * ground. The bar is the one thing both modes share, so it is pinned to the
 * dark tokens whatever the screen below it is — a ghost button on black must
 * not pick up the light mode's near-black text.
 */
export function Shell({
	mode,
	actions,
	overlay = false,
	children,
}: {
	mode: "dark" | "light";
	/** The bar's right-hand side: Add service and Settings, or the way back. */
	actions?: ReactNode;
	/**
	 * A see-through bar, for a screen whose first block is black and starts
	 * under it (`lg:-mt-[72px]`): the two then read as one stage. Only from
	 * `lg` up — narrower, the bar can wrap past 72px, so it stays solid. The
	 * ground turns black too and becomes a column, so the screen can lay its
	 * own glass over it and stretch that to the bottom (`flex-1`).
	 */
	overlay?: boolean;
	children: ReactNode;
}) {
	return (
		<div
			className={`${mode === "dark" ? "mode-dark" : "mode-light"} min-h-screen pb-[72px] text-fg ${overlay ? "flex flex-col bg-stage" : "bg-page"}`}
		>
			<header
				className={`mode-dark flex flex-wrap items-center justify-between gap-4 px-[4%] py-[18px] text-fg ${overlay ? "relative z-10 bg-stage lg:bg-transparent" : "bg-stage"}`}
			>
				{/* Text, not the PNG: the wordmark has to take the accent, and a
				    raster logo cannot. */}
				<span className="text-[28px] font-black leading-9 tracking-[-0.02em] text-accent">
					STUPEFLIX
				</span>
				{actions ? (
					<div className="flex items-center gap-2">{actions}</div>
				) : null}
			</header>
			{children}
		</div>
	);
}

/** The top bar's way back, to whichever screen this one was opened from. */
export function BackLink({
	label,
	onClick,
}: {
	label: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`${buttonClass("ghost", "sm")} pl-2`}
		>
			<svg
				aria-hidden="true"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth={2.5}
				strokeLinecap="round"
				strokeLinejoin="round"
				className="h-[18px] w-[18px]"
			>
				<path d="M15 5l-7 7 7 7" />
			</svg>
			{label}
		</button>
	);
}

/** Shown while a screen's first query is in flight. */
export function Spinner() {
	return (
		<div className="flex items-center justify-center py-12">
			<div className="h-8 w-8 animate-spin rounded-full border-b-2 border-accent" />
		</div>
	);
}
