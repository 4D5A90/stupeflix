import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { api } from "../api/client";
import { useRegistry } from "../hooks/useRegistry";
import {
	type SetupConfig,
	type StepId,
	buildDefaultConfig,
} from "../types/setup";
import { StepIndicator } from "./StepIndicator";
import { CredentialsStep } from "./steps/CredentialsStep";
import { PathsStep } from "./steps/PathsStep";
import { ProgressStep } from "./steps/ProgressStep";
import { ServicesStep } from "./steps/ServicesStep";

interface WizardProps {
	onComplete?: () => void;
}

export function Wizard({ onComplete }: WizardProps) {
	const { data: registry, isLoading } = useRegistry();
	const [step, setStep] = useState<StepId>("paths");

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

	const goToPaths = useCallback(() => setStep("paths"), []);
	const goToServices = useCallback(() => setStep("services"), []);
	const goToCredentials = useCallback(() => setStep("credentials"), []);
	const goToProgress = useCallback(() => setStep("progress"), []);

	const handleStartSetup = useCallback(() => {
		startSetup.mutate(activeConfig);
	}, [activeConfig, startSetup]);

	const handleRestart = useCallback(() => {
		setStep("paths");
		setConfig(null);
	}, []);

	if (isLoading || !registry) {
		return (
			<div className="flex items-center justify-center py-12">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
			</div>
		);
	}

	return (
		<>
			<StepIndicator current={step} />

			{step === "paths" ? (
				<PathsStep
					config={activeConfig}
					onChange={setConfig}
					onNext={goToServices}
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
				/>
			) : null}

			{startSetup.error ? (
				<div className="mt-4 p-4 bg-red-900/50 border border-red-700 rounded-lg">
					<p className="text-red-300 text-sm">
						{startSetup.error instanceof Error
							? startSetup.error.message
							: "Failed to start setup"}
					</p>
				</div>
			) : null}
		</>
	);
}
