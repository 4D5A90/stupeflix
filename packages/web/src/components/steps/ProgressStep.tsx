import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import { useSetupStatus } from "../../hooks/useSetupStatus";
import type { ServiceMeta, SetupConfig, StepStatus } from "../../types/setup";
import { Button } from "../ui/Button";
import { SetupPreflight } from "./SetupPreflight";
import { StepMatrix } from "./StepMatrix";

interface ProgressStepProps {
	registry: ServiceMeta[];
	config: SetupConfig;
	onStart: () => Promise<unknown>;
	onBack: () => void;
	onRestart: () => void;
	onComplete?: () => void;
}

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

const loadingSpinner = (
	<div className="flex items-center justify-center py-12">
		<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
	</div>
);

export function ProgressStep({
	registry,
	config,
	onStart,
	onBack,
	onRestart,
	onComplete,
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
	if (!source) return loadingSpinner;
	const live = launched && Boolean(status) && !isLoading;

	const stepValues = Object.values(source.steps);
	const total = stepValues.length;
	const done = live ? stepValues.filter((s) => DONE.includes(s)).length : 0;
	const hasFailed = live && stepValues.some((s) => s === "failed");
	const allCompleted = live && total > 0 && done === total;
	const running = live
		? Object.keys(source.steps).find(
				(key) => source.steps[key] === "in_progress",
			)
		: undefined;
	const failed = failure(source.steps, source.labels, registry);

	const message = !started
		? "Review your configuration before starting the setup."
		: hasFailed
			? failed
				? `Setup stopped — ${failed.service} could not finish`
				: "Setup stopped."
			: allCompleted
				? "Setup completed successfully"
				: running
					? `${source.labels[running] ?? running}\u2026`
					: "Setting up your media stack\u2026";

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-end justify-between gap-4">
				<div className="min-w-0">
					<h2 className="text-lg font-semibold">
						{started ? "Setup Progress" : "Summary"}
					</h2>
					<p
						className={`text-sm mt-0.5 truncate ${hasFailed ? "text-brand-300" : "text-gray-400"}`}
					>
						{message}
					</p>
				</div>
				<span className="text-sm font-mono text-gray-400 tabular-nums shrink-0">
					{started
						? `${total ? Math.round((done / total) * 100) : 0}%`
						: `${total} steps`}
				</span>
			</div>

			<div className="h-1 rounded-full bg-step-idle overflow-hidden shrink-0">
				<div
					className={`h-full rounded-full transition-[width] duration-500 ${
						hasFailed
							? "bg-step-fail"
							: allCompleted
								? "bg-step-done"
								: "bg-gradient-to-r from-brand-600 to-brand-400"
					}`}
					style={{ width: total ? `${(done / total) * 100}%` : "0%" }}
				/>
			</div>

			<StepMatrix
				registry={registry}
				steps={source.steps}
				labels={source.labels}
			/>

			{/* Everything that stops being true the moment the run starts. It sits
			    under the grid, so when it goes the grid does not move. */}
			<div
				className={`grid transition-all duration-500 ${
					started
						? "grid-rows-[0fr] opacity-0 -mt-4 pointer-events-none"
						: "grid-rows-[1fr] opacity-100"
				}`}
			>
				<div className="overflow-hidden">
					<SetupPreflight registry={registry} config={config} />
				</div>
			</div>

			{!started ? (
				<div className="flex justify-between">
					<Button variant="secondary" onClick={onBack}>
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

			{hasFailed ? (
				<div className="flex items-center gap-4 p-4 rounded-xl bg-step-fail/[0.08] border border-step-fail/30">
					<div className="flex-1 min-w-0 flex flex-col gap-1">
						<h3 className="text-sm font-semibold text-step-fail">
							{failed ? `${failed.service} · ${failed.label}` : "Setup failed"}
						</h3>
						{/* An *arr rejection is a JSON array of validations, not a
						    sentence: it scrolls inside its box instead of pushing the
						    matrix out of the screen. */}
						<pre className="text-[11px] leading-relaxed font-mono text-gray-400 whitespace-pre-wrap break-words max-h-28 overflow-y-auto">
							{status?.error}
						</pre>
					</div>
					<Button onClick={onRestart}>Try again</Button>
				</div>
			) : null}

			{allCompleted ? (
				<div className="flex items-center gap-4 p-4 rounded-xl bg-step-done/[0.07] border border-step-done/30">
					<div className="flex-1 min-w-0 flex flex-col gap-1">
						<h3 className="text-sm font-semibold text-step-done">
							Your media stack is ready
						</h3>
						<div className="flex gap-4 text-[11px] font-mono text-gray-500 tabular-nums">
							<span>
								<b className="font-medium text-gray-400">{total}</b> steps
							</span>
							<span>
								<b className="font-medium text-gray-400">
									{
										registry.filter((svc) => config.services[svc.id]?.enabled)
											.length
									}
								</b>{" "}
								services
							</span>
						</div>
					</div>
					{onComplete ? (
						<Button onClick={onComplete}>Go to dashboard</Button>
					) : null}
				</div>
			) : null}
		</div>
	);
}
