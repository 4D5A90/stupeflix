import type { ReactNode } from "react";
import type { ServiceMeta, StepStatus } from "../../types/setup";
import { ServiceIcon, serviceTint } from "../ui/ServiceIcon";

interface StepMatrixProps {
	registry: ServiceMeta[];
	steps: Record<string, StepStatus>;
	labels: Record<string, string>;
	/** What stopped the run, drawn under the row it belongs to. */
	failure?: ReactNode;
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
 * One row per service, one cell per step: forty steps read as eight rows, which
 * a list of forty labelled lines cannot do.
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
	pending: "bg-track",
	// The foreground, not the accent: an accent cell next to a red failure
	// reads as an error rather than as the step in flight. Blinking carries "now".
	in_progress: "bg-fg animate-pulse",
	completed: "bg-ok",
	// Done, and drawn so: the same green — but hollow, because nothing was sent
	// for it. A skip passed off as a success is what let a stale peer hide.
	skipped: "border-2 border-ok",
	failed: "bg-fail",
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

/** What the row says: where it is, in its own words. */
function readout(cells: Cell[]): string {
	const failed = cells.find((c) => c.status === "failed");
	if (failed) return `${failed.label} — failed`;
	const running = cells.find((c) => c.status === "in_progress");
	if (running) return running.label;
	const done = cells.filter(
		(c) => c.status === "completed" || c.status === "skipped",
	).length;
	const steps = (n: number) => `${n} step${n > 1 ? "s" : ""}`;
	// Before it starts, a row says how much work it is — which is what makes the
	// same grid readable on the summary screen, where nothing has run yet.
	if (done === 0) return steps(cells.length);
	const skipped = cells.filter((c) => c.status === "skipped").length;
	return done === cells.length && skipped > 0
		? `${steps(done)} done · ${skipped} already configured`
		: `${steps(done)} done`;
}

const READOUT_TONE = {
	failed: "text-fail",
	running: "text-fg",
	done: "text-ok",
	idle: "text-muted",
};

export function StepMatrix({
	registry,
	steps,
	labels,
	failure,
}: StepMatrixProps) {
	const rows = toRows(steps, labels, registry);

	return (
		<section aria-label="Steps" className="rounded-lg bg-card px-6 py-1">
			{rows.map((row) => {
				const state = rowState(row.cells);
				return (
					<div key={row.id} className="border-t border-line first:border-t-0">
						<div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
							{/* The runner's own row is not a service, so it takes no
							    service tint — a hue there would claim an identity. */}
							<span
								className={`grid h-9 w-9 flex-none place-items-center rounded ${
									row.id === RUNNER_ROW ? "bg-fg/[0.08] text-muted" : ""
								}`}
								style={row.id === RUNNER_ROW ? undefined : serviceTint(row.id)}
							>
								<ServiceIcon id={row.id} />
							</span>
							<strong className="flex-[0_0_110px] truncate">{row.name}</strong>
							<span className="flex flex-[1_1_200px] flex-wrap gap-[3px]">
								{row.cells.map((cell) => (
									<span
										key={cell.key}
										// A title, not a hover readout: the row's text says where it
										// is, and a cell names itself only when asked.
										title={
											cell.status === "skipped"
												? `${cell.label} — already configured`
												: cell.label
										}
										className={`h-3.5 w-3.5 rounded-sm transition-colors ${cellTone(cell, state)}`}
									/>
								))}
							</span>
							<span
								className={`flex-[0_1_260px] text-right font-mono text-[13px] ${READOUT_TONE[state]}`}
							>
								{readout(row.cells)}
							</span>
						</div>
						{state === "failed" ? failure : null}
					</div>
				);
			})}
		</section>
	);
}
