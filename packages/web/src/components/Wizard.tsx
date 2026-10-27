import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useRegistry } from "../hooks/useRegistry";
import {
	type SetupConfig,
	type StepId,
	buildDefaultConfig,
} from "../types/setup";
import { StepNav } from "./StepNav";
import { CredentialsStep } from "./steps/CredentialsStep";
import { PathsStep } from "./steps/PathsStep";
import { ProgressStep, type SetupPhase } from "./steps/ProgressStep";
import { ServicesStep } from "./steps/ServicesStep";
import { NavLayout } from "./ui/NavLayout";
import { Shell, Spinner } from "./ui/Shell";

interface WizardProps {
	onComplete?: () => void;
}

export function Wizard({ onComplete }: WizardProps) {
	const { data: registry, isLoading } = useRegistry();
	const [step, setStep] = useState<StepId>("paths");
	// Reported by the Setup step, which owns the run: the nav locks once it has
	// started and ticks everything once it is ready.
	const [phase, setPhase] = useState<SetupPhase>("review");

	// A step is a new page now, taller than the window: arriving on one halfway
	// down, where the previous step's Next button was, reads as a broken jump.
	// A block, not an arrow expression: Chrome's scrollTo now returns a Promise,
	// and an effect that returns one crashes React on cleanup.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs on step change only
	useEffect(() => {
		window.scrollTo(0, 0);
	}, [step]);

	const defaultConfig = useMemo(
		() => buildDefaultConfig(registry ?? []),
		[registry],
	);
	const [config, setConfig] = useState<SetupConfig | null>(null);

	const activeConfig = config ?? defaultConfig;

	const queryClient = useQueryClient();

	const startSetup = useMutation({
		mutationFn: api.startSetup,
		onSuccess: () => {
			queryClient.removeQueries({ queryKey: ["setup-status"] });
			setStep("progress");
		},
	});

	const goToHome = () => {
		window.location.href = "/";
	};
	const goToPaths = useCallback(() => setStep("paths"), []);
	const goToServices = useCallback(() => setStep("services"), []);
	const goToCredentials = useCallback(() => setStep("credentials"), []);
	const goToProgress = useCallback(() => setStep("progress"), []);

	// Awaited by the progress screen: until this resolves the server still holds
	// the previous run's statuses, and polling would paint them.
	const handleStartSetup = useCallback(
		() => startSetup.mutateAsync(activeConfig),
		[activeConfig, startSetup],
	);

	const handleRestart = useCallback(() => {
		setStep("paths");
		setConfig(null);
		setPhase("review");
	}, []);

	if (isLoading || !registry) {
		return (
			<Shell mode="light">
				<Spinner />
			</Shell>
		);
	}

	return (
		<Shell mode="light">
			<NavLayout
				title="Set up your stack"
				label="Setup steps"
				live={step === "progress"}
				nav={
					<StepNav
						current={step}
						locked={step === "progress" && phase !== "review"}
						done={phase === "ready"}
						onGo={setStep}
					/>
				}
			>
				{step === "paths" ? (
					<PathsStep
						config={activeConfig}
						onChange={setConfig}
						onNext={goToServices}
						onCancel={goToHome}
					/>
				) : null}

				{step === "services" ? (
					<ServicesStep
						registry={registry}
						config={activeConfig}
						onChange={setConfig}
						onNext={goToCredentials}
						onBack={goToPaths}
					/>
				) : null}

				{step === "credentials" ? (
					<CredentialsStep
						registry={registry}
						config={activeConfig}
						onChange={setConfig}
						onNext={goToProgress}
						onBack={goToServices}
					/>
				) : null}

				{step === "progress" ? (
					<ProgressStep
						registry={registry}
						config={activeConfig}
						onStart={handleStartSetup}
						onBack={goToCredentials}
						onRestart={handleRestart}
						onComplete={onComplete}
						onPhase={setPhase}
					/>
				) : null}

				{/* The run was refused before it began (400, 409): under the step's
			    own buttons, where the click that caused it was. */}
				{startSetup.error ? (
					<p
						role="alert"
						className="rounded bg-fail-bg p-4 text-sm font-bold text-fail"
					>
						{startSetup.error instanceof Error
							? startSetup.error.message
							: "Failed to start setup"}
					</p>
				) : null}
			</NavLayout>
		</Shell>
	);
}
