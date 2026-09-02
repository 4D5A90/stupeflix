import { useCallback, useEffect } from "react";
import type {
	ServiceMeta,
	SetupConfig,
	UnmetRequirement,
} from "../../types/setup";
import { checkRequirements, isSingleSelect } from "../../types/setup";
import { Button } from "../ui/Button";
import { RadioGroup } from "../ui/RadioGroup";

interface ServicesStepProps {
	registry: ServiceMeta[];
	config: SetupConfig;
	onChange: (config: SetupConfig) => void;
	onNext: () => void;
	onBack: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
	torrentClient: "Torrent Client",
	vpn: "VPN",
	indexer: "Indexer",
	mediaServer: "Media Server",
	mediaManager: "Media Manager",
	requests: "Requests",
	seeder: "Seeder",
};

/** What a service is still missing, in its own words when it gave one. */
function requirementText(unmet: UnmetRequirement): string {
	const label = CATEGORY_LABELS[unmet.category] ?? unmet.category;
	return unmet.reason ?? `Needs a ${label} service.`;
}

export function ServicesStep({
	registry,
	config,
	onChange,
	onNext,
	onBack,
}: ServicesStepProps) {
	// The API refuses the same thing before it does any work; this is only so the
	// wizard can say it now rather than after the user commits
	const { missing, warnings } = checkRequirements(
		registry,
		(id) => config.services[id]?.enabled ?? false,
	);
	const blocked = missing.length > 0;

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			// Enter must not walk past the disabled button
			if (e.key === "Enter" && !blocked) onNext();
		},
		[onNext, blocked],
	);

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleKeyDown]);

	const toggleService = (id: string, enabled: boolean) => {
		onChange({
			...config,
			services: { ...config.services, [id]: { enabled } },
		});
	};

	const selectSingle = (category: string, selectedId: string) => {
		const updated = { ...config.services };
		for (const svc of registry) {
			if (svc.category === category) {
				updated[svc.id] = { enabled: svc.id === selectedId };
			}
		}
		onChange({ ...config, services: updated });
	};

	// Group services by category in display order
	const CATEGORY_ORDER = [
		"vpn",
		"torrentClient",
		"indexer",
		"mediaManager",
		"mediaServer",
		"requests",
		"seeder",
	];
	const categoryMap = new Map<string, ServiceMeta[]>();
	for (const svc of registry) {
		const list = categoryMap.get(svc.category) ?? [];
		list.push(svc);
		categoryMap.set(svc.category, list);
	}
	const categories = [...categoryMap.entries()].sort(
		([a], [b]) =>
			(CATEGORY_ORDER.indexOf(a) === -1 ? 99 : CATEGORY_ORDER.indexOf(a)) -
			(CATEGORY_ORDER.indexOf(b) === -1 ? 99 : CATEGORY_ORDER.indexOf(b)),
	);

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-xl font-semibold mb-2">Services</h2>
				<p className="text-gray-400 text-sm">
					Choose which services to use in your media stack.
				</p>
			</div>

			<div className="space-y-3">
				{categories.map(([category, services]) => {
					const label = CATEGORY_LABELS[category] ?? category;
					const single = isSingleSelect(category);
					const enabledServices = services.filter(
						(s) => config.services[s.id]?.enabled,
					);
					const hasSelection = enabledServices.length > 0;

					return (
						<CategorySection
							key={category}
							label={label}
							hasSelection={hasSelection}
						>
							{(open) => {
								if (!open) {
									return (
										<div className="flex flex-wrap gap-1.5">
											{hasSelection ? (
												enabledServices.map((s) => (
													<span
														key={s.id}
														className="px-2 py-0.5 text-xs bg-brand-600/20 text-brand-300 border border-brand-500/30 rounded"
													>
														{s.name}
													</span>
												))
											) : (
												<span className="text-xs text-gray-600 italic">
													None selected
												</span>
											)}
										</div>
									);
								}

								if (single) {
									const selected = enabledServices[0];
									return (
										<div className="mt-3">
											<RadioGroup
												label=""
												options={[
													...services.map((s) => ({
														value: s.id,
														label: s.name,
														description: s.description,
													})),
													// Picking one must not be a one-way door: without
													// this row the only way back out of the category is
													// to restart the wizard.
													{ value: "", label: `No ${label}` },
												]}
												value={selected?.id ?? ""}
												onChange={(v) => selectSingle(category, v)}
											/>
										</div>
									);
								}

								return (
									<div className="mt-3 space-y-2">
										{services.map((svc) => {
											const enabled = config.services[svc.id]?.enabled ?? false;
											return (
												<button
													key={svc.id}
													type="button"
													onClick={() => toggleService(svc.id, !enabled)}
													className={`flex items-center justify-between gap-3 w-full px-4 py-3 rounded-md text-left transition-colors ${
														enabled
															? "bg-brand-600/20 border border-brand-500"
															: "bg-gray-700 border border-transparent hover:bg-gray-700/70"
													}`}
												>
													{/* min-w-0 so the text yields first: without it flexbox
													    shrinks the switch instead, and its knob — offset for
													    a 44px track — lands outside the pill */}
													<div className="min-w-0">
														<span className="text-gray-100">{svc.name}</span>
														<p className="text-gray-400 text-sm">
															{svc.description}
														</p>
														{/* Only once picked: the caveats matter when the
                                service is actually going to be installed */}
														{enabled && svc.notes?.length > 0 && (
															<ul className="mt-2 space-y-1 text-xs leading-relaxed text-brand-300/80">
																{svc.notes.map((note) => (
																	<li key={note} className="flex gap-1.5">
																		<span aria-hidden="true">•</span>
																		<span>{note}</span>
																	</li>
																))}
															</ul>
														)}
														{enabled && (
															<ul className="mt-2 space-y-1 text-xs leading-relaxed">
																{missing
																	.filter((u) => u.service === svc.id)
																	.map((u) => (
																		<li
																			key={u.category}
																			className="text-brand-400"
																		>
																			{requirementText(u)}
																		</li>
																	))}
																{warnings
																	.filter((u) => u.service === svc.id)
																	.map((u) => (
																		<li
																			key={u.category}
																			className="text-white/50"
																		>
																			{requirementText(u)}
																		</li>
																	))}
															</ul>
														)}
													</div>
													<div
														className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
															enabled ? "bg-brand-600" : "bg-gray-600"
														}`}
													>
														<span
															className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
																enabled ? "translate-x-6" : "translate-x-1"
															}`}
														/>
													</div>
												</button>
											);
										})}
									</div>
								);
							}}
						</CategorySection>
					);
				})}
			</div>

			{blocked ? (
				<div className="rounded-xl border border-brand-500/30 bg-brand-600/10 p-4 text-sm text-brand-200">
					<p className="font-medium">Some choices are incomplete</p>
					<ul className="mt-2 space-y-1 text-brand-200/80">
						{missing.map((u) => (
							<li key={`${u.service}.${u.category}`}>
								<span className="text-brand-200">
									{registry.find((s) => s.id === u.service)?.name ?? u.service}
								</span>{" "}
								— {requirementText(u)}
							</li>
						))}
					</ul>
				</div>
			) : null}

			<div className="flex justify-between">
				<Button variant="secondary" onClick={onBack}>
					Back
				</Button>
				<Button onClick={onNext} disabled={blocked}>
					Next
				</Button>
			</div>
		</div>
	);
}

import { type ReactNode, useState } from "react";

function CategorySection({
	label,
	hasSelection,
	children,
}: {
	label: string;
	hasSelection: boolean;
	children: (open: boolean) => ReactNode;
}) {
	const [open, setOpen] = useState(false);

	return (
		// A convenience target for the mouse only. The keyboard path is the real
		// <button> inside, which this duplicates — the div is not focusable, and
		// must not become so.
		// biome-ignore lint/a11y/useKeyWithClickEvents: the inner button is the keyboard path
		<div
			className={`p-4 rounded-xl border transition-colors ${
				hasSelection
					? "bg-gray-800/50 border-brand-500/30"
					: "bg-gray-800/30 border-gray-700"
			} ${!open ? "cursor-pointer" : ""}`}
			onClick={!open ? () => setOpen(true) : undefined}
		>
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					setOpen(!open);
				}}
				className="flex items-center justify-between w-full text-left"
			>
				<span className="flex items-center gap-2">
					<span className="text-gray-200 font-medium">{label}</span>
					{hasSelection ? (
						<span className="w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0" />
					) : null}
				</span>
				<svg
					aria-hidden="true"
					className={`w-4 h-4 text-gray-500 transition-transform shrink-0 ${open ? "rotate-180" : ""}`}
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					strokeWidth={2}
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						d="M19 9l-7 7-7-7"
					/>
				</svg>
			</button>
			{!open ? <div className="mt-2">{children(false)}</div> : children(true)}
		</div>
	);
}
