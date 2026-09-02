import { useState } from "react";
import type { CredentialField, ServiceMeta } from "../../types/setup";
import { ServiceIcon, serviceTint } from "../ui/ServiceIcon";
import { CATEGORY_LABELS } from "./categories";

/**
 * Picking or reconfiguring a service is a step of its own: it needs room for
 * notes and credential fields, and none of the running services matter while you
 * do it. So it replaces the dashboard rather than growing inside its grid.
 *
 * One component for both, because the form is the same — reconfiguring simply
 * arrives with the service already chosen and its current values filled in.
 */
export function ServiceSetupScreen({
	title,
	services,
	locked,
	installedCategories,
	initialCreds,
	submitVerb,
	submit,
	onBack,
	onDone,
}: {
	title: string;
	/** Choices to offer; empty when `locked` already names the service. */
	services: ServiceMeta[];
	locked?: ServiceMeta;
	/** Categories the installed services already cover, to resolve `requires`. */
	installedCategories: string[];
	initialCreds?: Record<string, string>;
	submitVerb: string;
	submit: (id: string, creds: Record<string, string>) => Promise<unknown>;
	onBack: () => void;
	onDone: (serviceId: string, serviceName: string) => void;
}) {
	const [picked, setPicked] = useState<ServiceMeta | null>(locked ?? null);
	const [creds, setCreds] = useState<Record<string, string>>(() =>
		initialCredsFor(locked, initialCreds),
	);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	// The API refuses this too, and says the same thing — but only once the form
	// has been filled in and sent, which is a poor moment to learn it
	const unmet = (picked?.requires ?? []).filter(
		(req) => !installedCategories.includes(req.category),
	);

	const selectService = (svc: ServiceMeta) => {
		setPicked(svc);
		setError(null);
		setCreds(initialCredsFor(svc, initialCreds));
	};

	const handleSubmit = async () => {
		if (!picked) return;
		setError(null);
		setBusy(true);
		try {
			await submit(picked.id, creds);
			onDone(picked.id, picked.name);
		} catch (e) {
			setError(e instanceof Error ? e.message : `${submitVerb} failed`);
			setBusy(false);
		}
	};

	return (
		<div className="space-y-5">
			<div className="flex items-center justify-between">
				<h2 className="text-xl font-semibold">{title}</h2>
				<button
					type="button"
					onClick={onBack}
					className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-400 border border-white/[0.12] rounded-md hover:text-gray-200 hover:border-gray-500 transition-colors"
				>
					<svg
						aria-hidden="true"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth={2}
						className="w-4 h-4"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M15 19l-7-7 7-7"
						/>
					</svg>
					Services
				</button>
			</div>

			{services.length > 0 ? (
				<div className="grid gap-3 sm:grid-cols-3">
					{services.map((svc) => (
						<button
							key={svc.id}
							type="button"
							onClick={() => selectService(svc)}
							aria-pressed={picked?.id === svc.id}
							className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
								picked?.id === svc.id
									? "border-brand-500 bg-brand-500/10"
									: "border-white/[0.07] bg-ink-800 hover:border-gray-500"
							}`}
						>
							<span
								className="grid h-9 w-9 shrink-0 place-items-center rounded-md"
								style={serviceTint(svc.id)}
							>
								<ServiceIcon id={svc.id} />
							</span>
							<span className="min-w-0">
								<span className="block truncate font-medium text-white">
									{svc.name}
								</span>
								<span className="block text-xs text-gray-500">
									{CATEGORY_LABELS[svc.category] ?? svc.category}
								</span>
							</span>
						</button>
					))}
				</div>
			) : null}

			{picked ? (
				<div
					className={`space-y-4 ${services.length > 0 ? "border-t border-white/[0.07] pt-5" : ""}`}
				>
					<p className="text-sm text-gray-400">{picked.description}</p>

					{picked.notes?.length > 0 ? (
						<ul className="space-y-1 rounded-md border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-xs leading-relaxed text-gray-400">
							{picked.notes.map((note) => (
								<li key={note} className="flex gap-2">
									<span className="text-gray-600">•</span>
									<span>{note}</span>
								</li>
							))}
						</ul>
					) : null}

					{unmet.length > 0 ? (
						<ul className="space-y-1 rounded-md border border-brand-500/30 bg-brand-600/10 px-3 py-2.5 text-xs leading-relaxed text-brand-200">
							{unmet.map((req) => (
								<li key={req.category} className="flex gap-2">
									<span className="text-brand-400">•</span>
									<span>
										{req.reason ?? `Needs a ${req.category} service first.`}
									</span>
								</li>
							))}
						</ul>
					) : null}

					{picked.credentials.length > 0 ? (
						<div className="space-y-2">
							{picked.credentials.map((field: CredentialField) => (
								<div key={field.key} className="flex items-center gap-3">
									<label
										htmlFor={`cred-${field.key}`}
										className="w-32 shrink-0 text-xs text-gray-500"
									>
										{field.label}
									</label>
									{field.type === "select" ? (
										<select
											id={`cred-${field.key}`}
											value={creds[field.key] ?? ""}
											onChange={(e) =>
												setCreds((prev) => ({
													...prev,
													[field.key]: e.target.value,
												}))
											}
											className="flex-1 px-3 py-1.5 text-sm bg-ink-950 border border-white/[0.12] rounded-md text-gray-200 focus:outline-none focus:border-brand-500"
										>
											{(field.options ?? []).map((option) => (
												<option key={option.value} value={option.value}>
													{option.label}
												</option>
											))}
										</select>
									) : (
										<input
											id={`cred-${field.key}`}
											type={field.type === "password" ? "password" : "text"}
											value={creds[field.key] ?? ""}
											onChange={(e) =>
												setCreds((prev) => ({
													...prev,
													[field.key]: e.target.value,
												}))
											}
											placeholder={
												field.placeholder ??
												(field.required === false ? "Optional" : "")
											}
											className="flex-1 px-3 py-1.5 text-sm bg-ink-950 border border-white/[0.12] rounded-md text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500"
										/>
									)}
								</div>
							))}
						</div>
					) : null}

					{error ? <p className="text-sm text-red-400">{error}</p> : null}

					<button
						type="button"
						onClick={handleSubmit}
						disabled={busy || unmet.length > 0}
						className="w-full py-2 text-sm font-medium text-white bg-brand-600 rounded-md hover:bg-brand-500 transition-colors disabled:opacity-50"
					>
						{busy
							? `${submitVerb}ing ${picked.name}…`
							: `${submitVerb} ${picked.name}`}
					</button>
				</div>
			) : (
				<p className="text-sm text-gray-500">
					Pick a service to see what it needs before installing.
				</p>
			)}
		</div>
	);
}

/** Stored values win over the template's defaults, so a reconfigure starts where you left off. */
function initialCredsFor(
	svc: ServiceMeta | null | undefined,
	stored?: Record<string, string>,
): Record<string, string> {
	if (!svc) return {};
	return Object.fromEntries(
		(svc.credentials ?? []).map((f: CredentialField) => [
			f.key,
			stored?.[f.key] ?? f.default ?? "",
		]),
	);
}
