/**
 * The services in the order the user dragged them into. The saved list is a
 * preference, not the truth: what is installed comes from the API, so a saved
 * id that is gone is skipped rather than shown, and one the list has never
 * seen goes at the end.
 */
export function applyOrder(ids: string[], saved: string[]): string[] {
	const present = new Set(ids);
	const ordered = [...new Set(saved)].filter((id) => present.has(id));
	const placed = new Set(ordered);
	return [...ordered, ...ids.filter((id) => !placed.has(id))];
}

/** `order` with `id` at `index`, clamped to the list; unchanged if absent. */
export function moveTo(order: string[], id: string, index: number): string[] {
	if (!order.includes(id)) return order;
	const rest = order.filter((x) => x !== id);
	rest.splice(Math.max(0, Math.min(rest.length, index)), 0, id);
	return rest;
}
