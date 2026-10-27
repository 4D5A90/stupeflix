import type { ReactNode } from "react";
import { useNight } from "../../hooks/useNight";
import { buttonClass } from "./Button";

/**
 * Every screen's frame: the black top bar, then the screen on its own mode's
 * ground. The bar is the one thing both modes share, so it is pinned to the
 * dark tokens whatever the screen below it is — a ghost button on black must
 * not pick up the light mode's near-black text.
 *
 * A light screen can be switched to night from the bar: it then takes the
 * dark tokens, so the whole screen changes and the two modes still never mix.
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
	const [night, toggleNight] = useNight();
	const shown = mode === "light" && !night ? "light" : "dark";
	return (
		<div
			className={`${shown === "dark" ? "mode-dark" : "mode-light"} min-h-screen pb-[72px] text-fg ${overlay ? "flex flex-col bg-stage" : "bg-page"}`}
		>
			<header
				className={`mode-dark flex flex-wrap items-center justify-between gap-4 px-[4%] py-[18px] text-fg ${overlay ? "relative z-10 bg-stage lg:bg-transparent" : "bg-stage"}`}
			>
				{/* Text, not the PNG: the wordmark has to take the accent, and a
				    raster logo cannot. */}
				<span className="text-[28px] font-black leading-9 tracking-[-0.02em] text-accent">
					STUPEFLIX
				</span>
				{actions || mode === "light" ? (
					<div className="flex items-center gap-2">
						{mode === "light" ? (
							<NightToggle night={night} onClick={toggleNight} />
						) : null}
						{actions}
					</div>
				) : null}
			</header>
			{children}
		</div>
	);
}

/** Sun or moon: the mode a click switches to, not the one in force. */
function NightToggle({
	night,
	onClick,
}: {
	night: boolean;
	onClick: () => void;
}) {
	const label = night ? "Switch to day mode" : "Switch to night mode";
	return (
		<button
			type="button"
			onClick={onClick}
			title={label}
			aria-label={label}
			className={`${buttonClass("ghost", "sm")} px-2`}
		>
			<svg
				aria-hidden="true"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				strokeWidth={1.8}
				strokeLinecap="round"
				strokeLinejoin="round"
				className="h-5 w-5"
			>
				{night ? (
					<path d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
				) : (
					<path d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
				)}
			</svg>
		</button>
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
