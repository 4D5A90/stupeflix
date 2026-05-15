import { useState } from "react";
import { useSetupStatus } from "../../hooks/useSetupStatus";
import { StatusBadge } from "../ui/StatusBadge";
import { Button } from "../ui/Button";
import type { SetupConfig, ServiceMeta, StepStatus } from "../../types/setup";

interface ProgressStepProps {
	registry: ServiceMeta[];
	config: SetupConfig;
	onStart: () => void;
	onBack: () => void;
	onRestart: () => void;
	onComplete?: () => void;
}

const GLOBAL_STEP_LABELS: Record<string, string> = {
	compose: "Generate Docker Compose",
	containers: "Start Containers",
};

function formatSubStep(name: string): string {
	return name
		.replace(/_/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

interface StepGroup {
	key: string;
	label: string;
	substeps: { key: string; label: string; status: StepStatus }[] | null;
	status: StepStatus;
}

function groupSteps(
	steps: Record<string, StepStatus>,
	registry: ServiceMeta[],
): StepGroup[] {
	const groups: StepGroup[] = [];
	const serviceSteps: Record<string, { key: string; label: string; status: StepStatus }[]> = {};

	for (const [key, status] of Object.entries(steps)) {
		if (!key.includes(".")) {
			groups.push({
				key,
				label: GLOBAL_STEP_LABELS[key] ?? formatSubStep(key),
				substeps: null,
				status,
			});
		} else {
			const [serviceId, stepName] = key.split(".", 2);
			if (!serviceSteps[serviceId]) serviceSteps[serviceId] = [];
			serviceSteps[serviceId].push({
				key,
				label: formatSubStep(stepName),
				status,
			});
		}
	}

	for (const [serviceId, substeps] of Object.entries(serviceSteps)) {
		const svc = registry.find((s) => s.id === serviceId);
		const hasAnyFailed = substeps.some((s) => s.status === "failed");
		const allCompleted = substeps.every((s) => s.status === "completed");
		const hasInProgress = substeps.some((s) => s.status === "in_progress");
		const groupStatus: StepStatus = hasAnyFailed
			? "failed"
			: allCompleted
				? "completed"
				: hasInProgress
					? "in_progress"
					: "pending";

		groups.push({
			key: serviceId,
			label: svc?.name ?? serviceId,
			substeps,
			status: groupStatus,
		});
	}

	return groups;
}

const loadingSpinner = (
	<div className="flex items-center justify-center py-12">
		<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
	</div>
);

function SuccessMessage({ onComplete }: { onComplete?: () => void }) {
	return (
		<div className="space-y-4">
			<div className="p-4 bg-green-900/50 border border-green-700 rounded-lg">
				<p className="text-green-300">
					Your media stack is ready! Access your services at their respective ports.
				</p>
			</div>
			{onComplete ? (
				<div className="flex justify-center">
					<Button onClick={onComplete}>Go to Dashboard</Button>
				</div>
			) : null}
		</div>
	);
}

function Recap({ registry, config }: { registry: ServiceMeta[]; config: SetupConfig }) {
	const enabledServices = registry.filter(
		(svc) => config.services[svc.id]?.enabled
	);

	const enabledWithCreds = enabledServices.filter(
		(svc) => svc.credentials.length > 0
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
						Torrents: <span className="text-gray-100">{config.paths.torrents}</span>
					</p>
				</div>
			</div>

			<div className="p-4 bg-gray-800 border border-gray-700 rounded-lg space-y-2">
				<h3 className="text-sm font-medium text-gray-300">Services</h3>
				<div className="flex flex-wrap gap-2">
					{enabledServices.map((svc) => (
						<span
							key={svc.id}
							className="px-2 py-1 text-sm bg-blue-600/20 text-blue-300 border border-blue-500/30 rounded"
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
								(f) => f.type === "email" || f.type === "text"
							);
							const displayValue = displayField
								? config.credentials[svc.id]?.[displayField.key]
								: undefined;
							return displayValue ? (
								<p key={svc.id} className="text-gray-400">
									{svc.name}: <span className="text-gray-100">{displayValue}</span>
								</p>
							) : null;
						})}
					</div>
				</div>
			) : null}
		</div>
	);
}

export function ProgressStep({ registry, config, onStart, onBack, onRestart, onComplete }: ProgressStepProps) {
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
	const hasFailed = stepValues.some((s) => s === "failed");
	const allCompleted = stepValues.length > 0 && stepValues.every((s) => s === "completed");
	const realStatus = hasFailed ? "failed" : allCompleted ? "completed" : "in_progress";

	const statusMessage =
		realStatus === "in_progress"
			? "Setting up your media stack..."
			: realStatus === "completed"
				? "Setup completed successfully!"
				: "Setup failed. Check the error below.";

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-xl font-semibold mb-2">Setup Progress</h2>
				<p className="text-gray-400 text-sm">{statusMessage}</p>
			</div>

			<div className="space-y-2">
				{groupSteps(status.steps, registry).map((group) => (
					<div key={group.key}>
						<StatusBadge status={group.status} label={group.label} />
						{group.substeps ? (
							<div className="ml-8 mt-1 space-y-1">
								{group.substeps.map((sub) => (
									<StatusBadge
										key={sub.key}
										status={sub.status}
										label={sub.label}
										small
									/>
								))}
							</div>
						) : null}
					</div>
				))}
			</div>

			{status.error ? (
				<div className="p-4 bg-red-900/50 border border-red-700 rounded-lg">
					<p className="text-red-300 text-sm font-mono">{status.error}</p>
				</div>
			) : null}

			{realStatus === "completed" ? <SuccessMessage onComplete={onComplete} /> : null}

			{realStatus === "failed" ? (
				<div className="flex justify-center">
					<Button onClick={onRestart}>Try Again</Button>
				</div>
			) : null}
		</div>
	);
}
