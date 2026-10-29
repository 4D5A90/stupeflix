import {
	type KeyboardEvent,
	type MouseEvent,
	type PointerEvent,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { applyOrder, moveTo } from "./tileOrder";

/** Past this many pixels a press is a drag; under it, still a click. */
const THRESHOLD = 6;
/** A finger has to hold first, or the page could never scroll under it. */
const LONG_PRESS = 350;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

interface Drag {
	id: string;
	li: HTMLElement;
	pointerId: number;
	startX: number;
	startY: number;
	/** Where in the card it was caught, so it does not jump under the pointer. */
	offX: number;
	offY: number;
	x: number;
	y: number;
	armed: boolean;
	started: boolean;
	timer?: ReturnType<typeof setTimeout>;
}

const reducedMotion = () =>
	matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Reordering the service grid by hand: drag a card, or Alt + ←/→ on a
 * focused one. While a card is held the others slide out of its way (FLIP,
 * through the Web Animations API like `ui/Collapse`), and the new order is
 * handed to `onReorder` once, on release.
 *
 * Every `<li>` must carry `data-id`; the cards spread `cardProps(id)`.
 */
export function useTileDrag(
	ids: string[],
	onReorder: (ids: string[]) => void,
	labelOf: (id: string) => string,
) {
	const gridRef = useRef<HTMLOListElement>(null);
	// The order on screen while a card is held, committed on release.
	const [draft, setDraft] = useState<string[] | null>(null);
	const [announcement, setAnnouncement] = useState("");
	// Laid over the live list, so a poll that adds or drops a service mid-drag
	// cannot leave the draft pointing at cards that are not on screen.
	const order = draft ? applyOrder(ids, draft) : ids;
	const orderRef = useRef(order);
	orderRef.current = order;
	const drag = useRef<Drag | null>(null);
	const before = useRef<Map<string, [number, number]> | null>(null);
	const refocus = useRef<string | null>(null);
	const swallowClick = useRef(false);
	const commit = useRef({ onReorder, labelOf });
	commit.current = { onReorder, labelOf };

	const slots = () => [...(gridRef.current?.children ?? [])] as HTMLElement[];

	/** Where every card sits now, for the slide once the order changes. */
	const snapshot = () => {
		before.current = new Map(
			slots().map((li) => [li.dataset.id ?? "", [li.offsetLeft, li.offsetTop]]),
		);
	};

	const announce = (id: string, list: string[]) =>
		setAnnouncement(
			`${commit.current.labelOf(id)} moved to position ${list.indexOf(id) + 1} of ${list.length}.`,
		);

	/** Keeps the held card under the pointer, wherever its slot now is. */
	const place = (d: Drag) => {
		const grid = gridRef.current;
		if (!grid) return;
		const g = grid.getBoundingClientRect();
		const x = d.x - d.offX - g.left - d.li.offsetLeft;
		const y = d.y - d.offY - g.top - d.li.offsetTop;
		d.li.style.transform = `translate(${x}px, ${y}px)`;
	};

	/** The slot whose centre is nearest the held card's centre. */
	const retarget = (d: Drag) => {
		const grid = gridRef.current;
		if (!grid) return;
		const g = grid.getBoundingClientRect();
		const cx = d.x - d.offX - g.left + d.li.offsetWidth / 2;
		const cy = d.y - d.offY - g.top + d.li.offsetHeight / 2;
		let target: string | undefined;
		let bestDistance = Number.POSITIVE_INFINITY;
		for (const li of slots()) {
			const distance = Math.hypot(
				li.offsetLeft + li.offsetWidth / 2 - cx,
				li.offsetTop + li.offsetHeight / 2 - cy,
			);
			if (distance < bestDistance) {
				bestDistance = distance;
				target = li.dataset.id;
			}
		}
		const list = orderRef.current;
		if (target && target !== d.id) {
			snapshot();
			setDraft(moveTo(list, d.id, list.indexOf(target)));
		}
	};

	const begin = (d: Drag) => {
		d.started = true;
		d.li.dataset.dragging = "";
		document.body.style.cursor = "grabbing";
		setDraft(orderRef.current);
		place(d);
	};

	// Runs after every render: slides the cards that moved, then puts the held
	// one back under the pointer, since its slot may have changed under it.
	useLayoutEffect(() => {
		const prev = before.current;
		if (prev) {
			before.current = null;
			const animate = !reducedMotion();
			for (const li of slots()) {
				const id = li.dataset.id ?? "";
				const from = prev.get(id);
				if (!from || !animate || id === drag.current?.id) continue;
				const dx = from[0] - li.offsetLeft;
				const dy = from[1] - li.offsetTop;
				if (dx || dy)
					li.animate(
						[
							{ transform: `translate(${dx}px, ${dy}px)` },
							{ transform: "none" },
						],
						{ duration: 260, easing: EASE },
					);
			}
		}
		if (drag.current?.started) place(drag.current);
		if (refocus.current) {
			gridRef.current
				?.querySelector<HTMLElement>(`[data-id="${refocus.current}"] button`)
				?.focus();
			refocus.current = null;
		}
	});

	useEffect(() => {
		const cancel = () => {
			clearTimeout(drag.current?.timer);
			drag.current = null;
		};
		// A cancelled pointer (the system took the gesture over) puts the cards
		// back; only a real release commits.
		const release = (e: globalThis.PointerEvent) => {
			const d = drag.current;
			if (!d || e.pointerId !== d.pointerId) return;
			cancel();
			if (!d.started) return;
			// The click the browser fires after a drag is not a pick.
			swallowClick.current = true;
			setTimeout(() => {
				swallowClick.current = false;
			}, 0);
			const held = d.li.style.transform;
			d.li.style.transform = "";
			delete d.li.dataset.dragging;
			document.body.style.cursor = "";
			if (held && !reducedMotion())
				d.li.animate([{ transform: held }, { transform: "none" }], {
					duration: 220,
					easing: EASE,
				});
			const final = orderRef.current;
			setDraft(null);
			if (e.type === "pointercancel" || final.join() === ids.join()) return;
			commit.current.onReorder(final);
			announce(d.id, final);
		};
		const move = (e: globalThis.PointerEvent) => {
			const d = drag.current;
			if (!d || e.pointerId !== d.pointerId) return;
			d.x = e.clientX;
			d.y = e.clientY;
			const distance = Math.hypot(d.x - d.startX, d.y - d.startY);
			if (!d.started) {
				// A finger that moves before the long press is scrolling.
				if (!d.armed && distance > THRESHOLD) cancel();
				else if (d.armed && distance > THRESHOLD) begin(d);
				return;
			}
			place(d);
			retarget(d);
		};
		// Once a card is lifted by a finger, the page must stop scrolling under
		// it. React's own touch listeners are passive and cannot prevent that.
		const holdScroll = (e: TouchEvent) => {
			if (drag.current?.started) e.preventDefault();
		};
		const grid = gridRef.current;
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", release);
		window.addEventListener("pointercancel", release);
		grid?.addEventListener("touchmove", holdScroll, { passive: false });
		return () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", release);
			window.removeEventListener("pointercancel", release);
			grid?.removeEventListener("touchmove", holdScroll);
		};
	});

	// Leaving the dashboard mid-drag must not leave the page grabbing.
	useEffect(
		() => () => {
			clearTimeout(drag.current?.timer);
			drag.current = null;
			document.body.style.cursor = "";
		},
		[],
	);

	const cardProps = (id: string) => ({
		onPointerDown: (e: PointerEvent<HTMLElement>) => {
			const li = e.currentTarget.closest("li");
			if (e.button !== 0 || !li) return;
			const rect = li.getBoundingClientRect();
			const d: Drag = {
				id,
				li,
				pointerId: e.pointerId,
				startX: e.clientX,
				startY: e.clientY,
				offX: e.clientX - rect.left,
				offY: e.clientY - rect.top,
				x: e.clientX,
				y: e.clientY,
				armed: e.pointerType === "mouse",
				started: false,
			};
			// A held finger lifts the card at once: by its first move the
			// browser would already be scrolling.
			if (!d.armed)
				d.timer = setTimeout(() => {
					d.armed = true;
					if (drag.current === d) begin(d);
				}, LONG_PRESS);
			drag.current = d;
		},
		onClickCapture: (e: MouseEvent<HTMLElement>) => {
			if (!swallowClick.current) return;
			e.preventDefault();
			e.stopPropagation();
		},
		onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
			const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
			if (!e.altKey || !step) return;
			e.preventDefault();
			const list = orderRef.current;
			const next = moveTo(list, id, list.indexOf(id) + step);
			if (next.indexOf(id) === list.indexOf(id)) return;
			snapshot();
			refocus.current = id;
			commit.current.onReorder(next);
			announce(id, next);
		},
	});

	return { order, gridRef, cardProps, announcement };
}
