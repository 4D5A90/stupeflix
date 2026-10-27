import { useState } from "react";
import {
	type CredentialField,
	type ServiceMeta,
	categoryLabel,
	credentialsReady,
	generatePassword,
	generatedLengthFor,
} from "../../types/setup";
import { Button } from "../ui/Button";
import { fieldClass } from "../ui/Input";
import { ServiceIcon, serviceTint } from "../ui/ServiceIcon";
import { BackLink, Shell } from "../ui/Shell";
import { Toggle } from "../ui/Toggle";
import { CATEGORY_LABELS } from "./categories";

/**
 * Picking or reconfiguring a service is a step of its own: it needs room for
 * notes and credential fields, and none of the running services matter while you
 * do it. So it replaces the dashboard rather than growing inside its grid — and
 * takes the light utility mode, since it is configuring, not watching.
 *
 * One component for both, because the form is the same — reconfiguring simply
 * arrives with the service already chosen and its current values filled in.
 */
export function ServiceSetupScreen({
	title,
	services,
	locked,
	installedCategories,
	withLeftovers,
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
	/** Services whose own settings a previous removal left on disk. */
	withLeftovers?: Set<string>;
	initialCreds?: Record<string, string>;
	submitVerb: string;
	submit: (
		id: string,
		creds: Record<string, string>,
		reset: boolean,
	) => Promise<unknown>;
	onBack: () => void;
	onDone: (serviceId: string, serviceName: string) => void;
}) {
	const [picked, setPicked] = useState<ServiceMeta | null>(locked ?? null);
	const [creds, setCreds] = useState<Record<string, string>>(() =>
		initialCredsFor(locked, initialCreds),
	);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	// Off by default: keeping what is there is the non-destructive reading, and
	// an ambiguous request never resolves to the destructive one.
	const [reset, setReset] = useState(false);

	// The API refuses this too, and says the same thing — but only once the form
	// has been filled in and sent, which is a poor moment to learn it
	const unmet = (picked?.requires ?? []).filter(
		(req) => !installedCategories.includes(req.category),
	);

	const selectService = (svc: ServiceMeta) => {
		setPicked(svc);
		setError(null);
		setReset(false);
		setCreds(initialCredsFor(svc, initialCreds));
	};

	const handleSubmit = async () => {
		if (!picked) return;
		setError(null);
		setBusy(true);
		try {
			await submit(picked.id, creds, reset);
			onDone(picked.id, picked.name);
		} catch (e) {
			setError(e instanceof Error ? e.message : `${submitVerb} failed`);
			setBusy(false);
		}
	};

	return (
		<Shell
			mode="light"
			actions={<BackLink label="Dashboard" onClick={onBack} />}
		>
			<div className="mx-auto flex max-w-[1200px] flex-col gap-5 px-[4%] pt-12">
				<h1 className="text-[40px] font-extrabold leading-[1.15]">{title}</h1>

				{services.length > 0 ? (
					<div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
						{services.map((svc) => (
							<button
								key={svc.id}
								type="button"
								onClick={() => selectService(svc)}
								aria-pressed={picked?.id === svc.id}
								className={`flex items-center gap-3 rounded-lg border-2 bg-card p-3 text-left transition-colors ${
									picked?.id === svc.id
										? "border-fg"
										: "border-transparent hover:border-line"
								}`}
							>
								<span
									className="grid h-9 w-9 shrink-0 place-items-center rounded"
									style={serviceTint(svc.id)}
								>
									<ServiceIcon id={svc.id} />
								</span>
								<span className="min-w-0">
									<span className="block truncate font-bold">{svc.name}</span>
									<span className="block text-[13px] text-muted">
										{categoryLabel(svc.category, CATEGORY_LABELS)}
									</span>
								</span>
							</button>
						))}
					</div>
				) : null}

				{picked ? (
					<section className="flex flex-col gap-4 rounded-lg bg-card p-6">
						<p className="text-muted">{picked.description}</p>

						{picked.notes?.length > 0 ? (
							<ul className="list-disc space-y-1 pl-[18px] text-sm leading-normal text-muted">
								{picked.notes.map((note) => (
									<li key={note}>{note}</li>
								))}
							</ul>
						) : null}

						{unmet.length > 0 ? (
							<ul className="space-y-1 rounded bg-fail-bg px-3.5 py-2.5 text-sm font-bold leading-[1.45] text-fail">
								{unmet.map((req) => (
									<li key={req.category}>
										{req.reason ?? `Needs a ${req.category} service first.`}
									</li>
								))}
							</ul>
						) : null}

						{picked.credentials.length > 0 ? (
							<div className="flex flex-col">
								{picked.credentials.map((field: CredentialField) => (
									<div
										key={field.key}
										className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line py-3 first:border-t-0"
									>
										<label
											htmlFor={`cred-${field.key}`}
											className="flex-[0_0_160px] font-bold"
										>
											{field.label}
										</label>
										<div className="flex min-w-0 flex-[1_1_280px] gap-2">
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
													className={fieldClass({ select: true })}
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
													className={fieldClass()}
												/>
											)}
											{field.type === "password" && field.generate !== false ? (
												<button
													type="button"
													onClick={() =>
														setCreds((prev) => ({
															...prev,
															[field.key]: generatePassword(
																generatedLengthFor(field),
															),
														}))
													}
													aria-label="Generate password"
													title="Generate password"
													className="grid h-11 w-11 flex-none place-items-center rounded border border-fg text-fg transition-colors hover:bg-fg/[0.06]"
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
									</div>
								))}
							</div>
						) : null}

						{withLeftovers?.has(picked.id) ? (
							<div className="flex flex-col gap-1.5 rounded bg-page p-4">
								<Toggle
									label={`Start ${picked.name} from a clean configuration`}
									checked={reset}
									onChange={setReset}
								/>
								<p className="text-sm text-muted">
									{picked.name} was installed here before and its settings are
									still on disk.{" "}
									{reset
										? "They will be deleted and rebuilt from the values above."
										: "They will be kept, and anything you changed in its own interface survives."}
								</p>
							</div>
						) : null}

						{error ? (
							<p role="alert" className="text-sm font-bold text-fail">
								{error}
							</p>
						) : null}

						<div className="flex justify-end">
							<Button
								onClick={handleSubmit}
								disabled={
									busy ||
									unmet.length > 0 ||
									!credentialsReady(picked.credentials, creds)
								}
							>
								{busy
									? `${submitVerb}ing ${picked.name}…`
									: `${submitVerb} ${picked.name}`}
							</Button>
						</div>
					</section>
				) : (
					<p className="text-muted">
						Pick a service to see what it needs before installing.
					</p>
				)}
			</div>
		</Shell>
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
