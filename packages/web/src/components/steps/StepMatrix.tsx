import { useState } from "react";
import type { ServiceMeta, StepStatus } from "../../types/setup";
import { ServiceIcon, serviceTint } from "../ui/ServiceIcon";

interface StepMatrixProps {
	registry: ServiceMeta[];
	steps: Record<string, StepStatus>;
	labels: Record<string, string>;
}

interface Cell {
	key: string;
	label: string;
	status: StepStatus;
}

interface Row {
	id: string;
	name: string;
	cells: Cell[];
}

/** The two steps no template owns — they are the runner's own, so they get a row. */
const RUNNER_ROW = "_runner";

/**
 * One row per service, one cell per step. Whatever the size of the stack, the
 * whole run stays on screen without scrolling — which a list of forty labelled
 * rows cannot do.
 */
function toRows(
	steps: Record<string, StepStatus>,
	labels: Record<string, string>,
	registry: ServiceMeta[],
): Row[] {
	const rows: Row[] = [];
	const rowFor = (id: string, name: string) => {
		let row = rows.find((r) => r.id === id);
		if (!row) {
			row = { id, name, cells: [] };
			rows.push(row);
		}
		return row;
	};

	for (const [key, status] of Object.entries(steps)) {
		const dot = key.indexOf(".");
		const serviceId = dot === -1 ? RUNNER_ROW : key.slice(0, dot);
		const name =
			dot === -1
				? "Docker"
				: (registry.find((s) => s.id === serviceId)?.name ?? serviceId);
		// A label always exists server-side; falling back to the key keeps a
		// mid-deploy mismatch readable rather than blank.
		rowFor(serviceId, name).cells.push({
			key,
			label: labels[key] ?? key,
			status,
		});
	}

	return rows;
}

const CELL_TONE: Record<StepStatus, string> = {
	pending: "bg-step-idle",
	// White, not the brand rose: a rose cell next to a red failure state reads
	// as an error rather than as the step in flight. Blinking carries "now".
	in_progress: "bg-white/80 animate-pulse",
	completed: "bg-step-done/60",
	// Same tone as completed: it is done. Only the hovered readout says that
	// nothing was sent for this one.
	skipped: "bg-step-done/60",
	failed: "bg-step-fail ring-2 ring-step-fail/30",
};

/**
 * A pending step in a row that failed was never reached — the runner stops at
 * the first error. Dimming it says so; leaving it identical would suggest it is
 * still waiting its turn.
 */
function cellTone(cell: Cell, state: string): string {
	const tone = CELL_TONE[cell.status];
	return state === "failed" && cell.status === "pending"
		? `${tone} opacity-40`
		: tone;
}

function rowState(cells: Cell[]): "running" | "failed" | "done" | "idle" {
	if (cells.some((c) => c.status === "failed")) return "failed";
	if (cells.some((c) => c.status === "in_progress")) return "running";
	if (cells.every((c) => c.status === "completed" || c.status === "skipped"))
		return "done";
	return "idle";
}

/** What the row says when nothing is hovered: where it is, in its own words. */
function readout(cells: Cell[]): string {
	const failed = cells.find((c) => c.status === "failed");
	if (failed) return `${failed.label} — failed`;
	const running = cells.find((c) => c.status === "in_progress");
	if (running) return running.label;
	const done = cells.filter(
		(c) => c.status === "completed" || c.status === "skipped",
	).length;
	// Before it starts, a row says how much work it is — which is what makes the
	// same grid readable on the summary screen, where nothing has run yet.
	if (done === 0) return `${cells.length} step${cells.length > 1 ? "s" : ""}`;
	return `${done} step${done > 1 ? "s" : ""} done`;
}

export function StepMatrix({ registry, steps, labels }: StepMatrixProps) {
	// The key, not the cell: the status is polled every second, so the objects
	// are rebuilt under the cursor and an identity check would drop the hover on
	// every tick.
	const [hovered, setHovered] = useState<string | null>(null);
	const rows = toRows(steps, labels, registry);

	return (
		// Height follows the rows, up to what the viewport leaves: a stack of
		// seven must not stretch to fill 600px, and a stack of twenty must
		// shrink instead of scrolling.
		<div className="flex flex-col gap-0.5 min-h-0 max-h-[calc(100vh-20rem)] overflow-hidden">
			{rows.map((row) => {
				const state = rowState(row.cells);
				const hover = row.cells.find((c) => c.key === hovered) ?? null;
				return (
					<div
						key={row.id}
						className={`grow shrink basis-11 max-h-11 min-h-[26px] grid grid-cols-[9.5rem_minmax(13rem,max-content)_1fr] items-center gap-3.5 px-2.5 rounded-lg border transition-colors ${
							state === "failed"
								? "bg-step-fail/[0.07] border-step-fail/30"
								: state === "running"
									? "bg-ink-800 border-white/[0.07]"
									: "border-transparent"
						}`}
					>
						<div className="flex items-center gap-2.5 min-w-0">
							{/* The runner's own row is not a service, so it takes no
							    service tint — a hue there would claim an identity. */}
							<div
								className={`w-6 h-6 shrink-0 grid place-items-center rounded-md ${
									row.id === RUNNER_ROW ? "bg-white/[0.06] text-gray-400" : ""
								}`}
								style={row.id === RUNNER_ROW ? undefined : serviceTint(row.id)}
							>
								<ServiceIcon id={row.id} />
							</div>
							<span className="text-sm font-semibold text-white truncate">
								{row.name}
							</span>
						</div>

						<div className="flex gap-1">
							{row.cells.map((cell) => (
								<div
									key={cell.key}
									title={cell.label}
									onMouseEnter={() => setHovered(cell.key)}
									onMouseLeave={() => setHovered(null)}
									className={`w-[15px] h-[15px] rounded transition-colors ${cellTone(cell, state)}`}
								/>
							))}
						</div>

						<span
							className={`text-xs font-mono truncate ${
								// Hovering names a step, it does not flag one: the accent is
								// reserved for what needs attention.
								hover
									? "text-white"
									: state === "failed"
										? "text-step-fail"
										: state === "running"
											? "text-white"
											: "text-gray-500"
							}`}
						>
							{hover
								? hover.status === "skipped"
									? `${hover.label} — already configured`
									: hover.label
								: readout(row.cells)}
						</span>
					</div>
				);
			})}
		</div>
	);
}
