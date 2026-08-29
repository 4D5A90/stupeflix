import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import type { DiskStat, LibraryStats } from "../api/client";
import type { CredentialField, ServiceMeta } from "../types/setup";
import { ActionIcon } from "./ui/ActionIcon";
import { InfoTooltip } from "./ui/InfoTooltip";
import { ServiceIcon } from "./ui/ServiceIcon";

interface DashboardProps {
	onReconfigure: () => void;
	onInstall: (serviceId: string, serviceName: string) => void;
}

const statusStyles: Record<
	string,
	{ dot: string; text: string; pill: string }
> = {
	running: {
		dot: "bg-green-500",
		text: "running",
		pill: "bg-green-500/10 text-green-400",
	},
	restarting: {
		dot: "bg-amber-500",
		text: "restarting",
		pill: "bg-amber-500/10 text-amber-400",
	},
	exited: {
		dot: "bg-red-500",
		text: "exited",
		pill: "bg-red-500/10 text-red-400",
	},
	not_found: {
		dot: "bg-gray-500",
		text: "missing",
		pill: "bg-gray-500/15 text-gray-400",
	},
};

/** Bytes to the shortest honest figure — 2.7 GB reads better than 2 700 000 000. */
function formatBytes(bytes: number): { value: string; unit: string } {
	const tb = bytes / 1e12;
	if (tb >= 1) return { value: tb.toFixed(1), unit: "TB" };
	return {
		value: (bytes / 1e9).toFixed(bytes / 1e9 >= 100 ? 0 : 1),
		unit: "GB",
	};
}

const CATEGORY_LABELS: Record<string, string> = {
	torrentClient: "Torrent",
	indexer: "Indexer",
	mediaServer: "Media",
	mediaManager: "Manager",
	seeder: "Seeder",
};

export function Dashboard({ onReconfigure, onInstall }: DashboardProps) {
	const queryClient = useQueryClient();

	const { data: services, isLoading } = useQuery({
		queryKey: ["services"],
		queryFn: api.getServices,
		refetchInterval: 5000,
	});

	const { data: registry } = useQuery({
		queryKey: ["registry"],
		queryFn: api.getRegistry,
	});

	// Counted off the filesystem, so it survives a stopped media server
	const { data: library } = useQuery({
		queryKey: ["library-stats"],
		queryFn: api.getLibraryStats,
		refetchInterval: 30000,
	});

	const { data: templates } = useQuery({
		queryKey: ["templates"],
		queryFn: api.getTemplates,
	});

	const { data: credentials } = useQuery({
		queryKey: ["credentials"],
		queryFn: api.getCredentials,
	});

	const [adding, setAdding] = useState(false);
	const [reconfiguring, setReconfiguring] = useState<string | null>(null);
	const [copied, setCopied] = useState<string | null>(null);

	const copyPassword = (serviceId: string) => {
		const cred = credentials?.[serviceId];
		const pass = cred?.pass ?? cred?.password ?? cred?.token;
		if (!pass) return;
		navigator.clipboard.writeText(pass);
		setCopied(serviceId);
		setTimeout(() => setCopied(null), 2000);
	};

	// Keyed by `service:action`, so two services can run their own action at once
	const [ranAction, setRanAction] = useState<string | null>(null);
	const [runningAction, setRunningAction] = useState<string | null>(null);

	const runAction = (service: string, action: string) => {
		const key = `${service}:${action}`;
		setRunningAction(key);
		const minSpin = new Promise((r) => setTimeout(r, 1000));
		Promise.all([api.runAction(service, action), minSpin])
			.then(() => {
				setRunningAction(null);
				setRanAction(key);
				setTimeout(() => setRanAction(null), 3000);
			})
			.catch(() => setRunningAction(null));
	};

	const invalidateTemplates = () => {
		queryClient.invalidateQueries({ queryKey: ["templates"] });
		queryClient.invalidateQueries({ queryKey: ["registry"] });
	};

	const reload = useMutation({
		mutationFn: api.reloadTemplates,
		onSuccess: () => {
			invalidateTemplates();
			setTimeout(() => reload.reset(), 3000);
		},
	});

	const upload = useMutation({
		mutationFn: api.uploadTemplate,
		onSuccess: invalidateTemplates,
	});

	if (isLoading || !services) {
		return (
			<div className="flex items-center justify-center py-12">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
			</div>
		);
	}

	const enabledServices = services.filter((s) => s.enabled);
	const enabledIds = new Set(enabledServices.map((s) => s.name));
	const uninstalled = (registry ?? []).filter((svc) => !enabledIds.has(svc.id));

	// Reconfiguring replays one service's template with new values; picking a new
	// one is the same form arriving empty. Both replace the dashboard.
	const reconfigureMeta = reconfiguring
		? (registry ?? []).find((svc) => svc.id === reconfiguring)
		: undefined;

	if (reconfiguring && reconfigureMeta) {
		return (
			<ServiceSetupScreen
				title={`Reconfigure ${reconfigureMeta.name}`}
				services={[]}
				locked={reconfigureMeta}
				initialCreds={credentials?.[reconfiguring]}
				submitVerb="Reconfigure"
				submit={(id, creds) => api.reconfigureService(id, creds)}
				onBack={() => setReconfiguring(null)}
				onDone={(id, name) => {
					setReconfiguring(null);
					onInstall(id, name);
				}}
			/>
		);
	}

	if (adding) {
		return (
			<ServiceSetupScreen
				title="Add a service"
				services={uninstalled}
				submitVerb="Install"
				submit={(id, creds) => api.installService(id, creds)}
				onBack={() => setAdding(false)}
				onDone={(id, name) => {
					setAdding(false);
					onInstall(id, name);
				}}
			/>
		);
	}

	return (
		<div className="space-y-6">
			<LibraryTiles library={library} />

			<div>
				<div className="flex items-end justify-between mb-3">
					<h2 className="text-xl font-semibold">Services</h2>
					<div className="flex items-center gap-3">
						<RunningCount
							running={
								enabledServices.filter((s) => s.status === "running").length
							}
							total={enabledServices.length}
						/>
						<button
							type="button"
							onClick={onReconfigure}
							className="px-3 py-1.5 text-sm text-red-400 border border-red-400/30 rounded-md hover:bg-red-400/10 transition-colors"
						>
							Reconfigure
						</button>
					</div>
				</div>

				<div className="grid gap-3 sm:grid-cols-2">
					{enabledServices.map((service) => {
						const style =
							statusStyles[service.status] ?? statusStyles.not_found;
						const label = service.label ?? service.name;
						const url = `http://localhost:${service.port}${service.webUiPath ?? ""}`;
						const secret =
							credentials?.[service.name]?.pass ??
							credentials?.[service.name]?.token;

						return (
							<div
								key={service.name}
								className="bg-ink-800 border border-white/[0.07] rounded-lg"
							>
								<div className="flex items-center gap-3 px-3.5 py-3">
									<div className="w-9 h-9 shrink-0 grid place-items-center rounded-md bg-ink-700 text-gray-400">
										<ServiceIcon id={service.name} />
									</div>
									<div className="flex-1 min-w-0 flex items-center gap-1.5">
										<span className="text-white font-semibold truncate">
											{label}
										</span>
										<InfoTooltip notes={service.notes ?? []} label={label} />
									</div>
									<div className="flex items-center gap-2.5">
										<span
											className={`inline-flex h-6 items-center gap-1.5 px-2.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${style.pill}`}
										>
											<span
												className={`w-1.5 h-1.5 rounded-full ${style.dot}`}
											/>
											{style.text}
										</span>
										<ServiceMenu
											name={service.name}
											label={label}
											onReconfigure={() => setReconfiguring(service.name)}
											onChanged={() => {
												queryClient.invalidateQueries({
													queryKey: ["services"],
												});
												queryClient.invalidateQueries({
													queryKey: ["registry"],
												});
											}}
										/>
									</div>
								</div>

								<div className="flex border-t border-white/[0.07] text-xs">
									{service.actions?.map((action) => {
										const key = `${service.name}:${action.id}`;
										const running = runningAction === key;
										return (
											<button
												key={key}
												type="button"
												onClick={() => runAction(service.name, action.id)}
												disabled={running}
												title={action.label}
												className="flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2 px-1 text-gray-400 border-r border-white/[0.07] last:border-r-0 first:rounded-bl-lg last:rounded-br-lg hover:text-brand-400 hover:bg-white/[0.03] transition-colors disabled:opacity-50"
											>
												{ranAction === key ? (
													<>
														<ActionIcon
															name="check"
															className="w-3.5 h-3.5 shrink-0 text-green-400"
														/>
														<span className="truncate text-green-400">
															Done
														</span>
													</>
												) : (
													<>
														<ActionIcon
															name={action.icon}
															className={`w-3.5 h-3.5 shrink-0 ${running ? (action.icon === "refresh" ? "animate-spin" : "animate-pulse") : ""}`}
														/>
														<span className="truncate">{action.label}</span>
													</>
												)}
											</button>
										);
									})}

									{secret ? (
										<button
											type="button"
											onClick={() => copyPassword(service.name)}
											title="Copy credentials"
											className="flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2 px-1 text-gray-400 border-r border-white/[0.07] last:border-r-0 first:rounded-bl-lg last:rounded-br-lg hover:text-brand-400 hover:bg-white/[0.03] transition-colors"
										>
											<ActionIcon
												name={copied === service.name ? "check" : "key"}
												className={`w-3.5 h-3.5 shrink-0 ${copied === service.name ? "text-green-400" : ""}`}
											/>
											<span
												className={`truncate ${copied === service.name ? "text-green-400" : ""}`}
											>
												{copied === service.name ? "Copied" : "Credentials"}
											</span>
										</button>
									) : null}

									<a
										href={url}
										target="_blank"
										rel="noopener noreferrer"
										title={`Open ${label}`}
										className="flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2 px-1 text-gray-400 border-r border-white/[0.07] last:border-r-0 first:rounded-bl-lg last:rounded-br-lg hover:text-brand-400 hover:bg-white/[0.03] transition-colors"
									>
										<ActionIcon name="open" className="w-3.5 h-3.5 shrink-0" />
										<span className="truncate">Open</span>
									</a>
								</div>
							</div>
						);
					})}

					{uninstalled.length > 0 && (
						<button
							type="button"
							onClick={() => setAdding(true)}
							className="flex h-full min-h-[5rem] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/[0.12] text-sm text-gray-500 transition-colors hover:border-gray-500 hover:text-gray-300"
						>
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth={2}
								className="w-4 h-4"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									d="M12 4v16m8-8H4"
								/>
							</svg>
							Add service
						</button>
					)}
				</div>
			</div>

			<div className="border-t border-white/[0.07] pt-6">
				<div className="flex items-center justify-between mb-5">
					<h2 className="text-xl font-semibold">Templates</h2>
					<div className="flex items-center gap-2">
						<label className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 bg-ink-800 hover:bg-ink-700 rounded-md transition-colors cursor-pointer">
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth={2}
								className="w-4 h-4"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									d="M12 4v16m8-8H4"
								/>
							</svg>
							Add
							<input
								type="file"
								accept=".yml,.yaml"
								className="hidden"
								onChange={(e) => {
									const file = e.target.files?.[0];
									if (file) upload.mutate(file);
									e.target.value = "";
								}}
							/>
						</label>
						<button
							type="button"
							onClick={() => reload.mutate()}
							disabled={reload.isPending}
							className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 bg-ink-800 hover:bg-ink-700 rounded-md transition-colors disabled:opacity-50"
						>
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth={2}
								className={`w-4 h-4 ${reload.isPending ? "animate-spin" : ""}`}
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
								/>
							</svg>
							Reload
						</button>
					</div>
				</div>
				{templates ? (
					<div className="flex flex-wrap gap-2">
						{templates.map((tpl) => (
							<div
								key={tpl.id}
								className="flex items-center gap-2 px-3 py-1.5 bg-ink-800 rounded-md"
							>
								<span className="text-gray-400">
									<ServiceIcon id={tpl.id} />
								</span>
								<span className="text-gray-200 text-sm">{tpl.name}</span>
								<span className="text-xs text-gray-500">
									{CATEGORY_LABELS[tpl.category] ?? tpl.category}
								</span>
							</div>
						))}
					</div>
				) : null}
				{reload.isSuccess ? (
					<p className="mt-2 text-xs text-green-400">
						Reloaded {reload.data.count} templates
					</p>
				) : null}
			</div>
		</div>
	);
}

/**
 * Lifecycle actions live on the status pill, not in the card's footer: the
 * footer holds what the *service* can do (its template declares those), while
 * these act on the container itself. Two kinds of verb, two places.
 */
function ServiceMenu({
	name,
	label,
	onReconfigure,
	onChanged,
}: {
	name: string;
	label: string;
	onReconfigure: () => void;
	onChanged: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [confirmingRemove, setConfirmingRemove] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);
	const wrapper = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) =>
			e.key === "Escape" && setOpen(false);
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	// Arming the confirmation must not outlive the menu it lives in
	useEffect(() => {
		if (!open) setConfirmingRemove(false);
	}, [open]);

	const run = async (kind: string, fn: () => Promise<unknown>) => {
		setBusy(kind);
		try {
			await fn();
			onChanged();
			setOpen(false);
		} finally {
			setBusy(null);
		}
	};

	const item =
		"flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-300 hover:bg-white/[0.05] transition-colors disabled:opacity-50";

	return (
		<div className="relative" ref={wrapper}>
			<button
				type="button"
				aria-label={`${label} — actions`}
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="grid h-6 w-7 place-items-center rounded-md border border-white/[0.12] text-gray-400 hover:border-gray-500 hover:bg-white/[0.05] hover:text-gray-200 transition-colors"
			>
				<svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
					<circle cx="5" cy="12" r="1.6" />
					<circle cx="12" cy="12" r="1.6" />
					<circle cx="19" cy="12" r="1.6" />
				</svg>
			</button>

			{open ? (
				<div className="absolute right-0 top-7 z-20 w-44 overflow-hidden rounded-md border border-white/[0.12] bg-ink-950 py-1 shadow-xl">
					<button
						type="button"
						disabled={busy !== null}
						onClick={() => run("restart", () => api.restartService(name))}
						className={item}
					>
						<ActionIcon
							name="refresh"
							className={`h-3.5 w-3.5 ${busy === "restart" ? "animate-spin" : ""}`}
						/>
						{busy === "restart" ? "Restarting…" : "Restart"}
					</button>

					<button
						type="button"
						disabled={busy !== null}
						onClick={() => {
							setOpen(false);
							onReconfigure();
						}}
						className={item}
					>
						<ActionIcon name="cog" className="h-3.5 w-3.5" />
						Reconfigure
					</button>

					<div className="my-1 border-t border-white/[0.07]" />

					{/* The only irreversible item here, so it asks twice */}
					<button
						type="button"
						disabled={busy !== null}
						onClick={() =>
							confirmingRemove
								? run("remove", () => api.deleteService(name))
								: setConfirmingRemove(true)
						}
						className={`${item} ${confirmingRemove ? "text-red-300 bg-red-500/10" : "text-red-400"}`}
					>
						<ActionIcon name="trash" className="h-3.5 w-3.5" />
						{busy === "remove"
							? "Removing…"
							: confirmingRemove
								? "Confirm remove"
								: "Remove"}
					</button>

					{confirmingRemove ? (
						<p className="px-3 pb-1.5 pt-0.5 text-[10px] leading-snug text-gray-500">
							Containers only — settings under config/ are kept.
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}

/**
 * One tile per configured library, plus the disk holding them. The count of
 * tiles is whatever the wizard produced, so the grid flows rather than assuming
 * a fixed set — a new library appears here without a line of code.
 */
/** Green only when it is good news — every service up. */
function RunningCount({ running, total }: { running: number; total: number }) {
	const tone =
		running === 0
			? "text-gray-500"
			: running < total
				? "text-amber-400"
				: "text-green-400";
	return (
		<span className={`font-mono text-xs ${tone}`}>
			{running}/{total} running
		</span>
	);
}

function LibraryTiles({ library }: { library?: LibraryStats }) {
	if (!library || (library.libraries.length === 0 && !library.disk))
		return null;

	return (
		<div
			className="grid gap-3"
			style={{ gridTemplateColumns: "repeat(auto-fit, minmax(9.5rem, 1fr))" }}
		>
			{library.libraries.map((lib) => (
				<div
					key={lib.name}
					className="px-4 pt-3.5 pb-3.5 bg-ink-800 border border-white/[0.07] rounded-lg"
				>
					<span className="block text-[10px] font-semibold uppercase tracking-widest text-gray-500">
						{lib.name}
					</span>
					<span className="block mt-2 text-2xl font-bold leading-none tabular-nums text-white">
						{lib.primary}
						<span className="ml-1.5 text-xs font-normal text-gray-500">
							{lib.primaryUnit}
						</span>
					</span>
					{/* Only worth a second line when it says something the first does not */}
					{lib.secondary !== lib.primary ? (
						<span className="block mt-2 text-xs text-gray-500 tabular-nums">
							{lib.secondary} {lib.secondaryUnit}
						</span>
					) : null}
				</div>
			))}
			{library.disk ? <DiskTile disk={library.disk} /> : null}
		</div>
	);
}

function DiskTile({ disk }: { disk: DiskStat }) {
	const used = formatBytes(disk.used);
	const total = formatBytes(disk.total);
	const percent =
		disk.total > 0
			? Math.min(100, Math.round((disk.used / disk.total) * 100))
			: 0;

	return (
		<div className="px-4 pt-3.5 pb-3.5 bg-ink-800 border border-white/[0.07] rounded-lg">
			<span className="block text-[10px] font-semibold uppercase tracking-widest text-gray-500">
				Disk
			</span>
			<span className="block mt-2 text-2xl font-bold leading-none tabular-nums text-white">
				{used.value}
				<span className="ml-1.5 text-xs font-normal text-gray-500">
					{used.unit} / {total.value} {total.unit}
				</span>
			</span>
			<div className="mt-3 h-1 rounded-full bg-white/10 overflow-hidden">
				<div className="h-full bg-brand-500" style={{ width: `${percent}%` }} />
			</div>
		</div>
	);
}

/**
 * Picking or reconfiguring a service is a step of its own: it needs room for
 * notes and credential fields, and none of the running services matter while you
 * do it. So it replaces the dashboard rather than growing inside its grid.
 *
 * One component for both, because the form is the same — reconfiguring simply
 * arrives with the service already chosen and its current values filled in.
 */
function ServiceSetupScreen({
	title,
	services,
	locked,
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
							<span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-ink-700 text-gray-400">
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
										placeholder={field.required === false ? "Optional" : ""}
										className="flex-1 px-3 py-1.5 text-sm bg-ink-950 border border-white/[0.12] rounded-md text-gray-200 placeholder-gray-600 focus:outline-none focus:border-brand-500"
									/>
								</div>
							))}
						</div>
					) : null}

					{error ? <p className="text-sm text-red-400">{error}</p> : null}

					<button
						type="button"
						onClick={handleSubmit}
						disabled={busy}
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
