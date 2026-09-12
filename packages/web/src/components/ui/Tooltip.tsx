import { useId, useState } from "react";

/**
 * A tooltip that carries a sentence, not a label.
 *
 * The browser's own `title` is fine for naming a button — "Copy credentials" —
 * and wrong for anything a user has to read: it waits a second, renders in the
 * OS chrome at the OS font size, wraps where it likes, and never appears for a
 * keyboard user at all. A template's `reason:` is written as a sentence, so it
 * needs somewhere legible to land.
 *
 * Opens on hover **and** focus: the trigger is a `<span>` on a card, so it is
 * given `tabIndex` here rather than asking every caller to remember.
 *
 * No portal. The dashboard grid sets no `overflow`, so an absolutely positioned
 * panel is not clipped, and a portal would cost a layer of positioning code to
 * solve a problem this layout does not have.
 */
export function Tooltip({
	text,
	children,
}: {
	text: string;
	children: React.ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const id = useId();

	return (
		<span
			className="relative inline-flex"
			onMouseEnter={() => setOpen(true)}
			onMouseLeave={() => setOpen(false)}
			onFocus={() => setOpen(true)}
			onBlur={() => setOpen(false)}
			// Escape closes it without moving focus, which is what a reader who
			// opened it by tabbing expects.
			onKeyDown={(e) => {
				if (e.key === "Escape") setOpen(false);
			}}
		>
			{/* A button, not a focusable span: the trigger has to be reachable by
			    keyboard, and making it interactive for real is also what gives it a
			    tap target — on a phone there is no hover to open it with. */}
			<button
				type="button"
				aria-describedby={open ? id : undefined}
				onClick={() => setOpen((o) => !o)}
				className="inline-flex cursor-help rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400/70"
			>
				{children}
			</button>
			<span
				id={id}
				role="tooltip"
				// `inert` rather than unmounting: the panel keeps its box so the fade
				// has something to animate, and stays out of the accessibility tree
				// and the tab order while closed.
				inert={!open}
				className={`absolute bottom-full left-1/2 z-30 mb-2 w-64 -translate-x-1/2 rounded-lg border border-white/[0.12] bg-ink-900 px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-gray-200 shadow-xl transition-opacity duration-150 ${
					open ? "opacity-100" : "pointer-events-none opacity-0"
				}`}
			>
				{text}
				{/* The notch, drawn as a rotated corner of the same panel so the
				    border and the ground stay in step with the box above it. */}
				<span className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-white/[0.12] bg-ink-900" />
			</span>
		</span>
	);
}
