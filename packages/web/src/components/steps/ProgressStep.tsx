import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useSetupStatus } from "../../hooks/useSetupStatus";
import type { ServiceMeta, SetupConfig, StepStatus } from "../../types/setup";
import { Button } from "../ui/Button";
import { Collapse } from "../ui/Collapse";
import { Spinner } from "../ui/Shell";
import { SetupPreflight } from "./SetupPreflight";
import { StepMatrix } from "./StepMatrix";

interface ProgressStepProps {
	registry: ServiceMeta[];
	config: SetupConfig;
	onStart: () => Promise<unknown>;
	onBack: () => void;
	onRestart: () => void;
	onComplete?: () => void;
	/** Where the run is, for the nav beside this step. */
	onPhase?: (phase: SetupPhase) => void;
}

export type SetupPhase = "review" | "running" | "failed" | "ready";

const DONE: StepStatus[] = ["completed", "skipped"];

/** Which step stopped the run, named the way the template names it. */
function failure(
	steps: Record<string, StepStatus>,
	labels: Record<string, string>,
	registry: ServiceMeta[],
): { service: string; label: string } | null {
	const key = Object.keys(steps).find((k) => steps[k] === "failed");
	if (!key) return null;
	const dot = key.indexOf(".");
	const id = dot === -1 ? null : key.slice(0, dot);
	return {
		service: id
			? (registry.find((svc) => svc.id === id)?.name ?? id)
			: "Docker",
		label: labels[key] ?? key,
	};
}

export function ProgressStep({
	registry,
	config,
	onStart,
	onBack,
	onRestart,
	onComplete,
	onPhase,
}: ProgressStepProps) {
	// Two flags, not one. `started` is the screen: the pre-flight goes, the grid
	// stays. `launched` is the server: only once the run has been accepted are
	// its statuses this run's — before that, `/setup/status` still answers with
	// the previous one, and polling it paints a finished run for a frame.
	const [started, setStarted] = useState(false);
	const [launched, setLaunched] = useState(false);
	const { data: status, isLoading } = useSetupStatus(launched);
	// The step list depends on the whole configuration — which services, how many
	// libraries, which conditions hold — so the server works it out rather than
	// the browser guessing. It writes nothing: this screen can still be left.
	const { data: preview } = useQuery({
		queryKey: ["setup-preview", config],
		queryFn: () => api.previewSetup(config),
		enabled: !started,
	});

	// Before the run, the grid is drawn from the preview; after, from the status.
	// Same component, same position in the tree, so React keeps the very same DOM
	// nodes: pressing the button does not rebuild a screen, it lights this one.
	// The cold grid stands in until the first real status arrives, so the wait
	// shows the same rows rather than a spinner where the grid was.
	const source = launched ? (status ?? preview) : preview;
	const live = launched && Boolean(status) && !isLoading;

	const stepValues = Object.values(source?.steps ?? {});
	const total = stepValues.length;
	const done = live ? stepValues.filter((s) => DONE.includes(s)).length : 0;
	const hasFailed = live && stepValues.some((s) => s === "failed");
	const allCompleted = live && total > 0 && done === total;
	const running =
		live && source
			? Object.keys(source.steps).find(
					(key) => source.steps[key] === "in_progress",
				)
			: undefined;
	const phase: SetupPhase = !started
		? "review"
		: hasFailed
			? "failed"
			: allCompleted
				? "ready"
				: "running";

	useEffect(() => {
		onPhase?.(phase);
	}, [onPhase, phase]);

	if (!source) return <Spinner />;
	const failed = failure(source.steps, source.labels, registry);
	const services = registry.filter(
		(svc) => config.services[svc.id]?.enabled,
	).length;

	const title = !started
		? "Summary"
		: allCompleted
			? "Your media stack is ready"
			: "Setup Progress";
	const message = !started
		? "Review your configuration before starting the setup."
		: hasFailed
			? failed
				? `Setup stopped — ${failed.service} could not finish`
				: "Setup stopped."
			: allCompleted
				? `${total} steps · ${services} services`
				: running
					? `${source.labels[running] ?? running}\u2026`
					: "Setting up your media stack\u2026";

	return (
		<>
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
				<div className="flex min-w-0 flex-col gap-1.5">
					<h2 className="text-[32px] font-bold leading-tight">{title}</h2>
					<p
						className={
							hasFailed
								? "font-bold text-fail"
								: started && !allCompleted
									? "text-fg"
									: "text-muted"
						}
					>
						{message}
					</p>
				</div>
				<span className="text-[32px] font-extrabold tabular-nums">
					{!started
						? `${total} steps`
						: allCompleted
							? ""
							: `${total ? Math.round((done / total) * 100) : 0}%`}
				</span>
			</div>

			{/* Kept under the heading: without it the run's progress is only the
			    percentage. */}
			<div className="h-1 shrink-0 overflow-hidden bg-track">
				<div
					className={`h-full transition-[width] duration-500 ${
						hasFailed ? "bg-fail" : allCompleted ? "bg-ok" : "bg-accent"
					}`}
					style={{ width: total ? `${(done / total) * 100}%` : "0%" }}
				/>
			</div>

			{/* Above the grid once it is all done: the next step is the only thing
			    left to read. */}
			{allCompleted && onComplete ? (
				<Button className="self-start" onClick={onComplete}>
					Go to dashboard
				</Button>
			) : null}

			<StepMatrix
				registry={registry}
				steps={source.steps}
				labels={source.labels}
				failure={
					hasFailed ? (
						<div className="mb-4 flex flex-col gap-3 rounded bg-fail-bg p-4 md:ml-[52px]">
							<strong className="text-fail">
								{failed
									? `${failed.service} · ${failed.label}`
									: "Setup failed"}
							</strong>
							{/* The error as the server wrote it: an *arr rejection is a JSON
							    array of validations, not a sentence, so it scrolls inside
							    its box instead of pushing the grid off the screen. */}
							<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-card px-3.5 py-3 font-mono text-[13px] leading-relaxed">
								{status?.error}
							</pre>
							<Button className="self-start" onClick={onRestart}>
								Try again
							</Button>
						</div>
					) : null
				}
			/>

			{/* Everything that stops being true the moment the run starts. It sits
			    under the grid, so when it goes the grid does not move. */}
			<Collapse open={!started}>
				<SetupPreflight registry={registry} config={config} />
			</Collapse>

			{!started ? (
				<div className="mt-2 flex justify-end gap-2">
					<Button variant="outline" onClick={onBack}>
						Back
					</Button>
					<Button
						onClick={async () => {
							setStarted(true);
							await onStart();
							setLaunched(true);
						}}
					>
						Start Setup
					</Button>
				</div>
			) : null}
		</>
	);
}
