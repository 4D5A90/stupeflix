import { type ReactNode, useLayoutEffect, useRef } from "react";

interface CollapseProps {
	open: boolean;
	children: ReactNode;
	/** Extra classes for the inner box — margins that belong to the content. */
	className?: string;
}

const DURATION = 320;
const EASING = "cubic-bezier(0.22, 0.8, 0.3, 1)";

/**
 * Opens and closes to whatever height its content happens to need.
 *
 * `height: auto` cannot be transitioned, and the two usual ways around it both
 * disappoint: a `max-height` cap spends its whole duration crossing space the
 * content never occupies and then snaps at the end, and
 * `grid-template-rows: 1fr → 0fr` fires no transition at all here — what looked
 * smooth was the opacity fading beside it.
 *
 * So the height is measured and animated to that number, driven by the Web
 * Animations API rather than a CSS transition: the animation is started by hand
 * on the element, which takes React's commit timing and class swapping out of
 * the picture.
 */
export function Collapse({ open, children, className }: CollapseProps) {
	const box = useRef<HTMLDivElement>(null);
	const inner = useRef<HTMLDivElement>(null);
	const wasOpen = useRef(open);

	// No dependency list: the content is measured after every render, which is
	// the only way to follow children that arrive later — the templates list is
	// empty on mount and fills in when its query resolves.
	useLayoutEffect(() => {
		const el = box.current;
		const content = inner.current;
		if (!el || !content) return;

		const target = open ? content.offsetHeight : 0;

		// Same state as last time: land on the height without animating, so
		// nothing slides when the screen first appears or the content grows.
		if (wasOpen.current === open) {
			el.style.height = `${target}px`;
			el.style.opacity = open ? "1" : "0";
			return;
		}
		wasOpen.current = open;

		const from = el.getBoundingClientRect().height;
		el.style.height = `${target}px`;
		el.style.opacity = open ? "1" : "0";
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

		for (const animation of el.getAnimations()) animation.cancel();
		el.animate(
			[
				{ height: `${from}px`, opacity: open ? 0 : 1 },
				{ height: `${target}px`, opacity: open ? 1 : 0 },
			],
			{ duration: DURATION, easing: EASING },
		);
	});

	return (
		<div
			ref={box}
			// Zero height already clips it, and `inert` takes the closed content out
			// of the tab order and the reading order — `visibility: hidden` would
			// stop it being rendered, and an element that is not rendered cannot
			// animate.
			className="overflow-hidden"
			aria-hidden={!open}
			inert={!open}
		>
			<div ref={inner} className={className}>
				{children}
			</div>
		</div>
	);
}
