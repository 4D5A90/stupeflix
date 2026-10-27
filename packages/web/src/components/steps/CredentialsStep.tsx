import { useCallback, useEffect } from "react";
import {
	type ServiceMeta,
	type SetupConfig,
	generatePassword,
	generatedLengthFor,
	validateField,
} from "../../types/setup";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { ServiceIcon, serviceTint } from "../ui/ServiceIcon";

interface CredentialsStepProps {
	registry: ServiceMeta[];
	config: SetupConfig;
	onChange: (config: SetupConfig) => void;
	onNext: () => void;
	onBack: () => void;
}

export function CredentialsStep({
	registry,
	config,
	onChange,
	onNext,
	onBack,
}: CredentialsStepProps) {
	const updateCredential = (serviceId: string, key: string, value: string) => {
		onChange({
			...config,
			credentials: {
				...config.credentials,
				[serviceId]: { ...config.credentials[serviceId], [key]: value },
			},
		});
	};

	const enabledWithCreds = registry.filter(
		(svc) => config.services[svc.id]?.enabled && svc.credentials.length > 0,
	);

	// Every service asking for an address wants the same one. Seeded, not forced:
	// a field already filled is left alone, so this can never undo a correction.
	useEffect(() => {
		const shared = config.email?.trim();
		if (!shared) return;
		let changed = false;
		const credentials = { ...config.credentials };
		for (const svc of enabledWithCreds) {
			for (const field of svc.credentials) {
				if (field.type !== "email") continue;
				if (credentials[svc.id]?.[field.key]) continue;
				credentials[svc.id] = { ...credentials[svc.id], [field.key]: shared };
				changed = true;
			}
		}
		if (changed) onChange({ ...config, credentials });
	}, [config, enabledWithCreds, onChange]);

	// In practice this holds one address. It is not there to offer a choice but to
	// hand back the one already known, for a field the seeding above skipped
	// because it was not empty, or that was cleared since.
	const knownEmails = [
		...new Set(
			[
				config.email,
				...enabledWithCreds.flatMap((svc) =>
					svc.credentials
						.filter((f) => f.type === "email")
						.map((f) => config.credentials[svc.id]?.[f.key]),
				),
			]
				.map((v) => v?.trim())
				.filter((v): v is string => Boolean(v)),
		),
	];

	const allErrors: Record<string, Record<string, string | null>> = {};
	for (const svc of enabledWithCreds) {
		allErrors[svc.id] = {};
		for (const field of svc.credentials) {
			const value = config.credentials[svc.id]?.[field.key] ?? "";
			allErrors[svc.id][field.key] = validateField(field, value);
		}
	}

	const hasErrors = Object.values(allErrors).some((fields) =>
		Object.values(fields).some((e) => e !== null),
	);

	const allFilled = enabledWithCreds.every((svc) =>
		svc.credentials.every(
			(f) => f.required === false || config.credentials[svc.id]?.[f.key],
		),
	);

	const canProceed = allFilled && !hasErrors;

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === "Enter" && canProceed) onNext();
		},
		[canProceed, onNext],
	);

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleKeyDown]);

	return (
		<>
			<div className="flex flex-col gap-1.5">
				<h2 className="text-[32px] font-bold leading-tight">Credentials</h2>
				<p className="text-muted">Set up authentication for your services.</p>
			</div>

			{enabledWithCreds.map((svc) => (
				<section
					key={svc.id}
					className="flex flex-col gap-4 rounded-lg bg-card px-6 pb-6 pt-5"
				>
					<h3 className="flex items-center gap-3 text-lg font-bold">
						<span
							className="grid h-9 w-9 flex-none place-items-center rounded"
							style={serviceTint(svc.id)}
						>
							<ServiceIcon id={svc.id} />
						</span>
						{svc.name}
					</h3>
					<div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
						{svc.credentials.map((field) => {
							const value = config.credentials[svc.id]?.[field.key] ?? "";
							const error = allErrors[svc.id]?.[field.key];
							return (
								<div key={field.key} className="flex flex-col gap-1.5">
									<div className="flex items-end gap-2">
										<div className="min-w-0 flex-1">
											{field.type === "select" ? (
												<Select
													label={field.label}
													options={field.options ?? []}
													value={value}
													onChange={(e) =>
														updateCredential(svc.id, field.key, e.target.value)
													}
												/>
											) : (
												<Input
													label={field.label}
													type={field.type === "text" ? undefined : field.type}
													error={Boolean(error)}
													suggestions={
														field.type === "email" ? knownEmails : undefined
													}
													autoComplete={
														field.type === "email"
															? "email"
															: field.type === "password"
																? "new-password"
																: undefined
													}
													placeholder={field.placeholder}
													value={value}
													onChange={(e) =>
														updateCredential(svc.id, field.key, e.target.value)
													}
												/>
											)}
										</div>
										{field.type === "password" && field.generate !== false ? (
											<button
												type="button"
												onClick={() => {
													updateCredential(
														svc.id,
														field.key,
														generatePassword(generatedLengthFor(field)),
													);
												}}
												className="grid h-11 w-11 flex-none place-items-center rounded border border-fg text-fg transition-colors hover:bg-fg/[0.06]"
												aria-label="Generate password"
												title="Generate password"
											>
												<svg
													aria-hidden="true"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth={2}
													className="h-[18px] w-[18px]"
												>
													<path
														strokeLinecap="round"
														strokeLinejoin="round"
														d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
													/>
												</svg>
											</button>
										) : null}
									</div>
									{error ? (
										<p className="text-[13px] font-bold text-fail">{error}</p>
									) : null}
								</div>
							);
						})}
					</div>
				</section>
			))}

			<div className="mt-2 flex justify-end gap-2">
				<Button variant="outline" onClick={onBack}>
					Back
				</Button>
				<Button onClick={onNext} disabled={!canProceed}>
					Next
				</Button>
			</div>
		</>
	);
}
