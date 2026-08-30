import { useSetupStatus } from "../hooks/useSetupStatus";
import { Button } from "./ui/Button";
import { StatusBadge } from "./ui/StatusBadge";

interface InstallProgressProps {
	serviceId: string;
	serviceName: string;
	onDone: () => void;
}

function formatLabel(stepKey: string, serviceId: string): string {
	const name = stepKey.replace(`${serviceId}.`, "");
	return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function InstallProgress({
	serviceId,
	serviceName,
	onDone,
}: InstallProgressProps) {
	const { data: status, isLoading } = useSetupStatus(true);

	const serviceSteps = Object.entries(status?.steps ?? {})
		.filter(([key]) => key.startsWith(`${serviceId}.`))
		.map(([key, stepStatus]) => ({
			key,
			label: formatLabel(key, serviceId),
			status: stepStatus,
		}));

	const global = status?.global;
	const isDone = global === "completed" || global === "failed";
	const isSuccess = global === "completed";

	if (isLoading || !status || global === "pending") {
		return (
			<div className="flex items-center justify-center py-12">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-xl font-semibold mb-2">
					{isSuccess
						? `${serviceName} installed`
						: isDone
							? "Installation failed"
							: `Installing ${serviceName}...`}
				</h2>
				<p className="text-gray-400 text-sm">
					{isSuccess
						? "The service is ready."
						: isDone
							? "An error occurred during installation."
							: "Setting up the service, please wait."}
				</p>
			</div>

			<div className="space-y-2">
				{serviceSteps.map((step) => (
					<StatusBadge key={step.key} status={step.status} label={step.label} />
				))}
			</div>

			{status.error ? (
				<div className="p-4 bg-red-900/50 border border-red-700 rounded-lg">
					<p className="text-red-300 text-sm font-mono">{status.error}</p>
				</div>
			) : null}

			{isDone ? (
				<div className="flex justify-center">
					<Button onClick={onDone}>Back to Dashboard</Button>
				</div>
			) : null}
		</div>
	);
}
