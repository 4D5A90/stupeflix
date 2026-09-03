import { useCallback, useEffect, useState } from "react";
import { useStacks } from "../../hooks/useStacks";
import type {
	ServiceMeta,
	SetupConfig,
	Stack,
	UnmetRequirement,
} from "../../types/setup";
import { checkRequirements, isSingleSelect } from "../../types/setup";
import { Button } from "../ui/Button";
import { CategoryIcon } from "../ui/CategoryIcon";

interface ServicesStepProps {
	registry: ServiceMeta[];
	config: SetupConfig;
	onChange: (config: SetupConfig) => void;
	onNext: () => void;
	onBack: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
	mediaServer: "Media Server",
	requests: "Requests",
	mediaManager: "Media Manager",
	indexer: "Indexer",
	torrentClient: "Torrent Client",
	vpn: "VPN",
	seeder: "Seeder",
};

/**
 * Most-picked first. This is no longer only cosmetic: it decides what a reader
 * sees before scrolling, so a category added below Seeder is a category most
 * people will never open.
 */
const CATEGORY_ORDER = [
	"mediaServer",
	"requests",
	"mediaManager",
	"indexer",
	"torrentClient",
	"vpn",
	"seeder",
];

/**
 * `fork` offers both paths, `stack` and `manual` each fold the other away. A
 * stack never mixes with a hand-built selection — that exclusivity is the whole
 * promise of the OR rule.
 */
type Mode = "fork" | "stack" | "manual";

export function ServicesStep({
	registry,
	config,
	onChange,
	onNext,
	onBack,
}: ServicesStepProps) {
	const { data: stacks } = useStacks();
	const available = stacks ?? [];
	const [mode, setMode] = useState<Mode>("fork");
	const [stackId, setStackId] = useState<string | null>(null);

	// Derived rather than synced: with nothing to choose from there is no fork
	// to draw, and no state to keep in step with a list that arrives late.
	const view: Mode = available.length === 0 ? "manual" : mode;

	const isEnabled = (id: string) => config.services[id]?.enabled ?? false;
	const enabled = registry.filter((svc) => isEnabled(svc.id));

	// A stack is proved by the gate before it ships, so only a hand-built
	// selection can be short of something.
	const report =
		view === "manual"
			? checkRequirements(registry, isEnabled)
			: { missing: [], warnings: [] };
	const blocked = report.missing.length > 0;
	const stalled = blocked || enabled.length === 0;

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === "Enter" && !stalled) onNext();
		},
		[onNext, stalled],
	);

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleKeyDown]);

	const select = (ids: string[]) => {
		const services: SetupConfig["services"] = {};
		for (const svc of registry) {
			services[svc.id] = { enabled: ids.includes(svc.id) };
		}
		onChange({ ...config, services });
	};

	const toggle = (svc: ServiceMeta) => {
		const ids = enabled.map((s) => s.id);
		if (isEnabled(svc.id)) {
			select(ids.filter((id) => id !== svc.id));
			return;
		}
		// Picking one of a single-select category releases whatever held it
		const freed = isSingleSelect(svc.category)
			? ids.filter(
					(id) => registry.find((s) => s.id === id)?.category !== svc.category,
				)
			: ids;
		select([...freed, svc.id]);
	};

	const pickStack = (stack: Stack) => {
		// Clicking the chosen one again releases it: never a one-way door
		if (stackId === stack.id) {
			setStackId(null);
			setMode("fork");
			select([]);
			return;
		}
		setStackId(stack.id);
		setMode("stack");
		select(stack.services);
	};

	const goTo = (next: Mode) => {
		setMode(next);
		setStackId(null);
		select([]);
	};

	const categories = CATEGORY_ORDER.map((id) => ({
		id,
		label: CATEGORY_LABELS[id] ?? id,
		services: registry.filter((svc) => svc.category === id),
	}))
		.concat(
			// Anything a template declares that this file has not been told about
			[...new Set(registry.map((s) => s.category))]
				.filter((id) => !CATEGORY_ORDER.includes(id))
				.map((id) => ({
					id,
					label: CATEGORY_LABELS[id] ?? id,
					services: registry.filter((svc) => svc.category === id),
				})),
		)
		.filter((c) => c.services.length > 0);

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-xl font-semibold mb-2">Services</h2>
				<p className="text-sm text-gray-400">
					{view === "manual"
						? "Choose which services to use in your media stack."
						: "Start from a stack, or choose services one by one."}
				</p>
			</div>

			<Alerts missing={report.missing} warnings={report.warnings} />

			{view === "manual" ? (
				<div className="space-y-4">
					{available.length > 0 ? (
						<button
							type="button"
							onClick={() => goTo("fork")}
							className="inline-flex items-center gap-2 rounded-lg border border-white/[0.07] bg-ink-800 py-1.5 pl-2.5 pr-3 text-xs text-gray-400 transition-colors hover:border-white/[0.12] hover:text-gray-200"
						>
							<Arrow className="rotate-180" />
							Start from a stack instead
						</button>
					) : null}

					<div className="overflow-hidden rounded-xl border border-white/[0.07]">
						{categories.map((cat) => (
							<div
								key={cat.id}
								/* The rule is drawn once for the group: taken per row it would
								   chop a category label that spans three services. */
								className="relative before:absolute before:inset-y-0 before:left-[60px] before:w-px before:bg-white/[0.07] before:content-[''] md:before:left-[170px] [&+div]:border-t [&+div]:border-white/[0.07]"
							>
								{cat.services.map((svc, i) => (
									<ServiceRow
										key={svc.id}
										service={svc}
										category={cat}
										first={i === 0}
										enabled={isEnabled(svc.id)}
										blocked={report.missing.some((m) => m.service === svc.id)}
										onToggle={() => toggle(svc)}
									/>
								))}
							</div>
						))}
					</div>

					<Notes services={enabled} />
				</div>
			) : (
				<div className="space-y-5">
					<div className="grid gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(215px,1fr))]">
						{available.map((stack) => (
							<StackCard
								key={stack.id}
								stack={stack}
								registry={registry}
								picked={stackId === stack.id}
								onPick={() => pickStack(stack)}
							/>
						))}
					</div>

					<div className="flex items-center gap-3.5">
						<span className="h-px flex-1 bg-white/[0.07]" />
						<span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-gray-500">
							or
						</span>
						<span className="h-px flex-1 bg-white/[0.07]" />
					</div>

					<button
						type="button"
						onClick={() => goTo("manual")}
						className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-dashed border-white/[0.12] py-3.5 text-sm text-gray-400 transition-colors hover:border-brand-500 hover:bg-brand-600/5 hover:text-gray-200"
					>
						Choose services one by one
						<Arrow />
					</button>
				</div>
			)}

			<div className="flex items-center justify-between">
				<Button variant="secondary" onClick={onBack}>
					Back
				</Button>
				<div className="flex items-center gap-3.5">
					<span className="font-mono text-xs text-gray-500">
						{enabled.length} selected
					</span>
					{/* Still "Next": the alert above says what is wrong, and a button
					    that renames itself explains a state it does not own. Disabled
					    is already the whole message. */}
					<Button onClick={onNext} disabled={stalled}>
						Next
					</Button>
				</div>
			</div>
		</div>
	);
}

function ServiceRow({
	service,
	category,
	first,
	enabled,
	blocked,
	onToggle,
}: {
	service: ServiceMeta;
	category: { id: string; label: string };
	first: boolean;
	enabled: boolean;
	blocked: boolean;
	onToggle: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onToggle}
			/* The tint covers the whole row, category column included — stopping at
			   the gutter leaves a step. The rule between rows starts at the gutter,
			   for the reason above. Hence a pseudo-element, not a border. */
			className={`relative grid w-full grid-cols-[40px_minmax(0,1fr)_36px] items-center gap-3 px-3.5 py-1.5 text-left transition-colors md:grid-cols-[150px_122px_minmax(0,1fr)_36px] [&+button]:before:absolute [&+button]:before:left-[60px] [&+button]:before:right-0 [&+button]:before:top-0 [&+button]:before:h-px [&+button]:before:bg-white/[0.07] [&+button]:before:content-[''] md:[&+button]:before:left-[170px] ${
				enabled ? "bg-brand-600/[0.09]" : "hover:bg-white/[0.035]"
			} ${blocked ? "shadow-[inset_2px_0_0_theme(colors.brand.700)]" : ""}`}
		>
			<span className="flex min-w-0 items-center gap-2.5 text-[11px] font-semibold uppercase leading-tight tracking-[0.07em] text-gray-500">
				<span
					className={`grid h-6 w-6 shrink-0 place-items-center rounded-md bg-ink-700 text-brand-300 ${
						first ? "" : "invisible"
					}`}
				>
					<CategoryIcon category={category.id} className="h-3.5 w-3.5" />
				</span>
				<span className="hidden md:inline">{first ? category.label : ""}</span>
			</span>

			<span className="truncate pl-2 text-[13.5px] font-medium text-gray-100">
				{service.name}
			</span>

			<span className="hidden truncate text-xs text-gray-500 md:block">
				{service.description}
			</span>

			<Switch on={enabled} />
		</button>
	);
}

function StackCard({
	stack,
	registry,
	picked,
	onPick,
}: {
	stack: Stack;
	registry: ServiceMeta[];
	picked: boolean;
	onPick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onPick}
			aria-pressed={picked}
			className={`relative flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors ${
				picked
					? "border-brand-500 bg-brand-600/10"
					: "border-white/[0.07] bg-ink-800 hover:border-white/[0.12]"
			}`}
		>
			{/* Out of the flow: holding its width while invisible would leave a
			    hole before every unselected title. */}
			<Check
				className={`absolute right-3.5 top-3.5 h-3.5 w-3.5 text-brand-400 ${
					picked ? "" : "invisible"
				}`}
			/>
			<span className="pr-6 text-sm font-semibold text-gray-100">
				{stack.name}
			</span>
			<span className="flex-1 text-xs leading-relaxed text-gray-500">
				{stack.description}
			</span>
			<span className="flex flex-wrap gap-1">
				{stack.services.map((id) => (
					<span
						key={id}
						className="rounded bg-ink-700 px-1.5 py-0.5 font-mono text-[10px] text-gray-400"
					>
						{registry.find((s) => s.id === id)?.name ?? id}
					</span>
				))}
			</span>
		</button>
	);
}

/** Everything the current selection is missing, above everything else. */
function Alerts({
	missing,
	warnings,
}: {
	missing: UnmetRequirement[];
	warnings: UnmetRequirement[];
}) {
	if (missing.length === 0 && warnings.length === 0) return null;
	return (
		<div className="space-y-2">
			{missing.length > 0 ? (
				<div
					role="alert"
					className="flex gap-3 rounded-xl border border-brand-800 bg-brand-900/40 p-3.5 text-brand-200"
				>
					<Warn className="mt-0.5 h-5 w-5 shrink-0" />
					<div>
						<p className="text-[13px] font-semibold">
							Can’t continue — {missing.length}{" "}
							{missing.length > 1
								? "services are missing something they need"
								: "service is missing something it needs"}
						</p>
						<ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-relaxed">
							{missing.map((u) => (
								<li key={`${u.service}.${u.category}`}>{u.reason}</li>
							))}
						</ul>
					</div>
				</div>
			) : null}

			{warnings.length > 0 ? (
				<div className="flex gap-3 rounded-xl border border-amber-700/60 bg-amber-500/[0.08] p-3.5 text-amber-300">
					<Warn className="mt-0.5 h-5 w-5 shrink-0" />
					<div>
						<p className="text-[13px] font-semibold">
							Worth knowing — you can carry on
						</p>
						<ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-relaxed">
							{warnings.map((u) => (
								<li key={`${u.service}.${u.category}`}>{u.reason}</li>
							))}
						</ul>
					</div>
				</div>
			) : null}
		</div>
	);
}

/** Only for what is actually going to be installed, where the caveats apply. */
function Notes({ services }: { services: ServiceMeta[] }) {
	const withNotes = services.filter((svc) => svc.notes?.length > 0);
	if (withNotes.length === 0) return null;
	return (
		<div className="space-y-2.5 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
			{withNotes.map((svc) => (
				<div key={svc.id}>
					<p className="text-xs font-semibold text-gray-300">{svc.name}</p>
					<ul className="mt-1 space-y-1 text-xs leading-relaxed text-gray-500">
						{svc.notes.map((note) => (
							<li key={note} className="flex gap-1.5">
								<span aria-hidden="true">•</span>
								<span>{note}</span>
							</li>
						))}
					</ul>
				</div>
			))}
		</div>
	);
}

function Switch({ on }: { on: boolean }) {
	return (
		<span className="flex justify-end">
			<span
				className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
					on ? "bg-brand-600" : "bg-ink-700"
				}`}
			>
				<span
					className={`absolute top-1 inline-block h-3 w-3 rounded-full bg-white transition-transform ${
						on ? "translate-x-5" : "translate-x-1"
					}`}
				/>
			</span>
		</span>
	);
}

function Arrow({ className = "" }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2}
			strokeLinecap="round"
			strokeLinejoin="round"
			className={`h-3.5 w-3.5 ${className}`}
		>
			<path d="M5 12h14m0 0l-6-6m6 6l-6 6" />
		</svg>
	);
}

function Check({ className = "" }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={2.4}
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			<path d="M5 13l4 4L19 7" />
		</svg>
	);
}

function Warn({ className = "" }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.8}
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
		>
			<path d="M12 9v4m0 4h.01M10.3 3.9L2.5 17.4A2 2 0 004.2 20.4h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
		</svg>
	);
}
