import { useCallback, useEffect } from "react";
import type {
	CredentialField,
	ServiceMeta,
	SetupConfig,
} from "../../types/setup";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";

interface CredentialsStepProps {
	registry: ServiceMeta[];
	config: SetupConfig;
	onChange: (config: SetupConfig) => void;
	onNext: () => void;
	onBack: () => void;
}

function generatePassword(length = 8): string {
	const chars = "abcdefghijkmnpqrstuvwxyz23456789";
	const array = new Uint8Array(length);
	crypto.getRandomValues(array);
	return Array.from(array, (b) => chars[b % chars.length]).join("");
}

function validateField(field: CredentialField, value: string): string | null {
	if (!value) return null;
	const rules = field.rules;
	if (!rules) return null;
	if (rules.minLength && value.length < rules.minLength) {
		return rules.message ?? `Must be at least ${rules.minLength} characters`;
	}
	if (rules.maxLength && value.length > rules.maxLength) {
		return rules.message ?? `Must be at most ${rules.maxLength} characters`;
	}
	if (rules.pattern && !new RegExp(rules.pattern).test(value)) {
		return rules.message ?? "Invalid format";
	}
	return null;
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
		<div className="space-y-6">
			<div>
				<h2 className="text-xl font-semibold mb-2">Credentials</h2>
				<p className="text-gray-400 text-sm">
					Set up authentication for your services.
				</p>
			</div>

			<div className="space-y-6">
				{enabledWithCreds.map((svc) => (
					<div key={svc.id} className="space-y-4">
						<h3 className="text-lg font-medium text-gray-300">{svc.name}</h3>
						<div className="grid grid-cols-2 gap-4">
							{svc.credentials.map((field) => {
								const value = config.credentials[svc.id]?.[field.key] ?? "";
								const error = allErrors[svc.id]?.[field.key];
								return (
									<div key={field.key}>
										<div className="flex items-end gap-1">
											<div className="flex-1">
												{field.type === "select" ? (
													<Select
														label={field.label}
														options={field.options ?? []}
														value={value}
														onChange={(e) =>
															updateCredential(
																svc.id,
																field.key,
																e.target.value,
															)
														}
													/>
												) : (
													<Input
														label={field.label}
														type={
															field.type === "text" ? undefined : field.type
														}
														placeholder={field.placeholder}
														value={value}
														onChange={(e) =>
															updateCredential(
																svc.id,
																field.key,
																e.target.value,
															)
														}
													/>
												)}
											</div>
											{field.type === "password" ? (
												<button
													type="button"
													onClick={() => {
														const minLen = field.rules?.minLength ?? 8;
														updateCredential(
															svc.id,
															field.key,
															generatePassword(Math.max(minLen, 8)),
														);
													}}
													className="mb-0.5 p-2 text-gray-400 hover:text-brand-400 transition-colors"
													title="Generate password"
												>
													<svg
														aria-hidden="true"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														strokeWidth={2}
														className="w-5 h-5"
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
											<p className="mt-1 text-xs text-red-400">{error}</p>
										) : null}
									</div>
								);
							})}
						</div>
					</div>
				))}
			</div>

			<div className="flex justify-between">
				<Button variant="secondary" onClick={onBack}>
					Back
				</Button>
				<Button onClick={onNext} disabled={!canProceed}>
					Next
				</Button>
			</div>
		</div>
	);
}
