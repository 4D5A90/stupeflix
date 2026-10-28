import { useSetupStatus } from "../hooks/useSetupStatus";
import { Button } from "./ui/Button";
import { Shell, Spinner } from "./ui/Shell";
import { StatusBadge } from "./ui/StatusBadge";

interface InstallProgressProps {
	serviceId: string;
	serviceName: string;
	onDone: () => void;
}

export function InstallProgress({
	serviceId,
	serviceName,
	onDone,
}: InstallProgressProps) {
	const { data: status, isLoading } = useSetupStatus(true);

	// The label comes from the template's `label:`, served with the status —
	// title-casing the key here gave "Download Client" for "Connect qBittorrent".
	const serviceSteps = Object.entries(status?.steps ?? {})
		.filter(([key]) => key.startsWith(`${serviceId}.`))
		.map(([key, stepStatus]) => ({
			key,
			label: status?.labels[key] ?? key,
			status: stepStatus,
		}));

	const global = status?.global;
	const isDone = global === "completed" || global === "failed";
	const isSuccess = global === "completed";

	if (isLoading || !status || global === "pending") {
		return (
			<Shell mode="light">
				<Spinner />
			</Shell>
		);
	}

	return (
		<Shell mode="light">
			<main
				aria-live="polite"
				className="mx-auto flex max-w-[720px] flex-col gap-5 px-[4%] pt-12"
			>
				<div className="flex flex-col gap-1.5">
					<h2 className="text-[32px] font-bold leading-tight">
						{isSuccess
							? `${serviceName} installed`
							: isDone
								? "Installation failed"
								: `Installing ${serviceName}...`}
					</h2>
					<p className="text-muted">
						{isSuccess
							? "The service is ready."
							: isDone
								? "An error occurred during installation."
								: "Setting up the service, please wait."}
					</p>
				</div>

				<div className="flex flex-col gap-2">
					{serviceSteps.map((step) => (
						<StatusBadge
							key={step.key}
							status={step.status}
							label={step.label}
						/>
					))}
				</div>

				{status.error ? (
					<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-fail-bg p-4 font-mono text-[13px] leading-relaxed text-fail">
						{status.error}
					</pre>
				) : null}

				{isDone ? (
					<Button className="self-start" onClick={onDone}>
						Back to Dashboard
					</Button>
				) : null}
			</main>
		</Shell>
	);
}
