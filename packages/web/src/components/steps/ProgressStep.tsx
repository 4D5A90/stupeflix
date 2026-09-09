import { useState } from "react";
import { useSetupStatus } from "../../hooks/useSetupStatus";
import type { ServiceMeta, SetupConfig, StepStatus } from "../../types/setup";
import { Button } from "../ui/Button";
import { StepMatrix } from "./StepMatrix";

interface ProgressStepProps {
	registry: ServiceMeta[];
	config: SetupConfig;
	onStart: () => void;
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

function Recap({
	registry,
	config,
}: { registry: ServiceMeta[]; config: SetupConfig }) {
	const enabledServices = registry.filter(
		(svc) => config.services[svc.id]?.enabled,
	);

	const enabledWithCreds = enabledServices.filter(
		(svc) => svc.credentials.length > 0,
	);

	return (
		<div className="space-y-4">
			<div className="p-4 bg-gray-800 border border-gray-700 rounded-lg space-y-2">
				<h3 className="text-sm font-medium text-gray-300">Paths</h3>
				<div className="text-sm space-y-1">
					<p className="text-gray-400">
						Config: <span className="text-gray-100">{config.paths.config}</span>
					</p>
					<p className="text-gray-400">
						Media: <span className="text-gray-100">{config.paths.media}</span>
					</p>
					{config.libraries.map((lib, i) => (
						<p key={lib.name} className="text-gray-500 text-xs ml-4">
							{i < config.libraries.length - 1 ? "├── " : "└── "}
							<span className="text-gray-300">{lib.name}/</span>
						</p>
					))}
					<p className="text-gray-400">
						Torrents:{" "}
						<span className="text-gray-100">{config.paths.torrents}</span>
					</p>
				</div>
			</div>

			<div className="p-4 bg-gray-800 border border-gray-700 rounded-lg space-y-2">
				<h3 className="text-sm font-medium text-gray-300">Services</h3>
				<div className="flex flex-wrap gap-2">
					{enabledServices.map((svc) => (
						<span
							key={svc.id}
							className="px-2 py-1 text-sm bg-brand-600/20 text-brand-300 border border-brand-500/30 rounded"
						>
							{svc.name}
						</span>
					))}
				</div>
			</div>

			{enabledWithCreds.length > 0 ? (
				<div className="p-4 bg-gray-800 border border-gray-700 rounded-lg space-y-2">
					<h3 className="text-sm font-medium text-gray-300">Credentials</h3>
					<div className="text-sm space-y-1">
						{enabledWithCreds.map((svc) => {
							const displayField = svc.credentials.find(
								(f) => f.type === "email" || f.type === "text",
							);
							const displayValue = displayField
								? config.credentials[svc.id]?.[displayField.key]
								: undefined;
							return displayValue ? (
								<p key={svc.id} className="text-gray-400">
									{svc.name}:{" "}
									<span className="text-gray-100">{displayValue}</span>
								</p>
							) : null;
						})}
					</div>
				</div>
			) : null}
		</div>
	);
}

export function ProgressStep({
	registry,
	config,
	onStart,
	onBack,
	onRestart,
	onComplete,
}: ProgressStepProps) {
	const [started, setStarted] = useState(false);
	const { data: status, isLoading } = useSetupStatus(started);

	if (!started) {
		return (
			<div className="space-y-6">
				<div>
					<h2 className="text-xl font-semibold mb-2">Summary</h2>
					<p className="text-gray-400 text-sm">
						Review your configuration before starting the setup.
					</p>
				</div>

				<Recap registry={registry} config={config} />

				<div className="flex justify-between">
					<Button variant="secondary" onClick={onBack}>
						Back
					</Button>
					<Button
						onClick={() => {
							setStarted(true);
							onStart();
						}}
					>
						Start Setup
					</Button>
				</div>
			</div>
		);
	}

	if (isLoading || !status || status.global === "pending") {
		return loadingSpinner;
	}

	const stepValues = Object.values(status.steps);
	const total = stepValues.length;
	const done = stepValues.filter((s) => DONE.includes(s)).length;
	const hasFailed = stepValues.some((s) => s === "failed");
	const allCompleted = total > 0 && done === total;
	const running = Object.keys(status.steps).find(
		(key) => status.steps[key] === "in_progress",
	);
	const failed = failure(status.steps, status.labels, registry);

	const message = hasFailed
		? failed
			? `Setup stopped — ${failed.service} could not finish`
			: "Setup stopped."
		: allCompleted
			? "Setup completed successfully"
			: running
				? `${status.labels[running] ?? running}\u2026`
				: "Setting up your media stack\u2026";

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-end justify-between gap-4">
				<div className="min-w-0">
					<h2 className="text-lg font-semibold">Setup Progress</h2>
					<p
						className={`text-sm mt-0.5 truncate ${hasFailed ? "text-brand-300" : "text-gray-400"}`}
					>
						{message}
					</p>
				</div>
				<span className="text-sm font-mono text-gray-400 tabular-nums shrink-0">
					{total ? Math.round((done / total) * 100) : 0}%
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
				steps={status.steps}
				labels={status.labels}
			/>

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
							{status.error}
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
