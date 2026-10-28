import { type ReactNode, useCallback, useEffect } from "react";
import { useStacks } from "../../hooks/useStacks";
import type {
	ServiceMeta,
	SetupConfig,
	Stack,
	UnmetRequirement,
} from "../../types/setup";
import {
	categoryLabel,
	checkRequirements,
	isSingleSelect,
} from "../../types/setup";
import { Button } from "../ui/Button";
import { ServiceIcon, serviceTint } from "../ui/ServiceIcon";

interface ServicesStepProps {
	registry: ServiceMeta[];
	config: SetupConfig;
	onChange: (config: SetupConfig) => void;
	choice: ServicesChoice;
	onChoiceChange: (choice: ServicesChoice) => void;
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
	stats: "Statistics",
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
	"stats",
	"vpn",
	"seeder",
];

/**
 * `fork` is before any choice: the stacks are offered, nothing is ticked.
 * `stack` and `manual` are the two answers to one radio group, so a stack never
 * mixes with a hand-built selection — that exclusivity is the whole promise of
 * the OR rule.
 */
type Mode = "fork" | "stack" | "manual";

/**
 * Which way the user went, kept by the wizard and not by this step: the ticks
 * live in `config`, but without this the step remounts on the fork and hides
 * them behind a choice the user already made.
 */
export interface ServicesChoice {
	mode: Mode;
	stackId: string | null;
}

export const INITIAL_SERVICES_CHOICE: ServicesChoice = {
	mode: "fork",
	stackId: null,
};

export function ServicesStep({
	registry,
	config,
	onChange,
	choice,
	onChoiceChange,
	onNext,
	onBack,
}: ServicesStepProps) {
	const { data: stacks } = useStacks();
	const available = stacks ?? [];
	const { mode, stackId } = choice;

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

	// A radio: picking the chosen stack again is not a change, so there is no
	// toggling off to handle — leaving a stack is picking something else.
	const pickStack = (stack: Stack) => {
		onChoiceChange({ mode: "stack", stackId: stack.id });
		select(stack.services);
	};

	// The stack's services stay ticked: going one by one from a stack is
	// adjusting it, not starting over.
	const pickManual = () => {
		onChoiceChange({ mode: "manual", stackId: null });
	};

	const categories = CATEGORY_ORDER.map((id) => ({
		id,
		label: categoryLabel(id, CATEGORY_LABELS),
		services: registry.filter((svc) => svc.category === id),
	}))
		.concat(
			// Anything a template declares that this file has not been told about
			[...new Set(registry.map((s) => s.category))]
				.filter((id) => !CATEGORY_ORDER.includes(id))
				.map((id) => ({
					id,
					label: categoryLabel(id, CATEGORY_LABELS),
					services: registry.filter((svc) => svc.category === id),
				})),
		)
		.filter((c) => c.services.length > 0);

	const missingFor = (id: string) =>
		report.missing.filter((m) => m.service === id);
	const warningsFor = (id: string) =>
		report.warnings.filter((m) => m.service === id);
	const blockedCount = new Set(report.missing.map((m) => m.service)).size;

	return (
		<>
			<div className="flex flex-col gap-1.5">
				<h2 className="text-[32px] font-bold leading-tight">Services</h2>
				<p className="text-muted">
					{available.length === 0
						? "Choose which services to use in your media stack."
						: "Start from a stack, or choose services one by one."}
				</p>
			</div>

			{available.length > 0 ? (
				<section
					role="radiogroup"
					aria-label="Start from a stack"
					className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-3"
				>
					{available.map((stack) => (
						<StackCard
							key={stack.id}
							name={stack.name}
							emoji={stack.emoji}
							description={stack.description}
							count={`${stack.services.length} services`}
							picked={view === "stack" && stackId === stack.id}
							onPick={() => pickStack(stack)}
						>
							{/* The list is only worth reading once a stack is in play. */}
							{view === "stack" && stackId === stack.id ? (
								<span className="text-[13px] leading-snug text-muted">
									{stack.services
										.map((id) => registry.find((s) => s.id === id)?.name ?? id)
										.join(" · ")}
								</span>
							) : null}
						</StackCard>
					))}
					<StackCard
						name="Choose services one by one"
						description="Choose which services to use in your media stack."
						picked={view === "manual"}
						onPick={pickManual}
					/>
				</section>
			) : null}

			{view === "manual" ? (
				<div className="mt-1 grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] items-start gap-4">
					{categories.map((cat) => (
						<section
							key={cat.id}
							className="flex flex-col rounded-lg bg-card px-5 pb-0.5 pt-4"
						>
							<h3 className="mb-1 flex items-baseline gap-2.5 text-lg font-bold">
								{cat.label}
								{isSingleSelect(cat.id) ? (
									<span className="text-sm font-normal text-muted">
										One at most
									</span>
								) : null}
							</h3>
							<div>
								{cat.services.map((svc) => (
									<ServiceRow
										key={svc.id}
										service={svc}
										enabled={isEnabled(svc.id)}
										missing={missingFor(svc.id)}
										warnings={warningsFor(svc.id)}
										onToggle={() => toggle(svc)}
									/>
								))}
							</div>
						</section>
					))}
				</div>
			) : null}

			{view !== "fork" ? <Notes services={enabled} /> : null}

			<div className="mt-2 flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
				<span className="mr-auto font-mono text-sm text-muted">
					{enabled.length} selected
				</span>
				{/* The row says what is wrong; this only says that something is, next
				    to the button it disables. */}
				<span aria-live="polite" className="text-sm font-bold text-fail">
					{blockedCount > 0
						? `${blockedCount} ${blockedCount > 1 ? "services are" : "service is"} missing something`
						: ""}
				</span>
				<Button variant="outline" onClick={onBack}>
					Back
				</Button>
				{/* Still "Next": a button that renames itself explains a state it
				    does not own. Disabled is already the whole message. */}
				<Button onClick={onNext} disabled={stalled}>
					Next
				</Button>
			</div>
		</>
	);
}

function ServiceRow({
	service,
	enabled,
	missing,
	warnings,
	onToggle,
}: {
	service: ServiceMeta;
	enabled: boolean;
	/** What it requires and does not have — only ever set in the manual view. */
	missing: UnmetRequirement[];
	warnings: UnmetRequirement[];
	onToggle: () => void;
}) {
	return (
		<div className="flex flex-col gap-2 border-t border-line py-3.5 first:border-t-0">
			<label className="flex cursor-pointer items-center gap-3.5">
				<span
					className="grid h-9 w-9 flex-none place-items-center rounded"
					style={serviceTint(service.id)}
				>
					<ServiceIcon id={service.id} />
				</span>
				<span className="flex min-w-0 flex-auto flex-col gap-0.5">
					<strong>{service.name}</strong>
					<span className="text-sm text-muted">{service.description}</span>
				</span>
				<input
					type="checkbox"
					checked={enabled}
					onChange={onToggle}
					className="h-[22px] w-[22px] flex-none accent-fg"
				/>
			</label>
			{/* Under the row that has the problem, not in a banner above them all:
			    a requirement belongs to its service. */}
			{missing.map((u) => (
				<p
					key={u.category}
					role="alert"
					className="ml-[50px] rounded bg-fail-bg px-3.5 py-2.5 text-sm font-bold leading-[1.45] text-fail"
				>
					{u.reason}
				</p>
			))}
			{warnings.map((u) => (
				<p
					key={u.category}
					className="ml-[50px] text-sm leading-[1.45] text-warn"
				>
					<strong>Worth knowing</strong> — {u.reason}
				</p>
			))}
		</div>
	);
}

/** A radio dressed as a card; the input stays the real control. */
function StackCard({
	name,
	emoji,
	description,
	count,
	picked,
	onPick,
	children,
}: {
	name: string;
	emoji?: string;
	description: string;
	count?: string;
	picked: boolean;
	onPick: () => void;
	children?: ReactNode;
}) {
	return (
		<label
			className={`flex cursor-pointer flex-col gap-1.5 rounded-lg border-2 bg-card p-4 transition-colors ${
				picked ? "border-fg" : "border-transparent hover:border-line"
			}`}
		>
			<span className="flex items-center justify-between gap-2">
				<input
					type="radio"
					name="stack"
					checked={picked}
					onChange={onPick}
					className="m-0 h-5 w-5 accent-fg"
				/>
				{count ? <span className="text-[13px] text-muted">{count}</span> : null}
			</span>
			<strong className="flex items-baseline gap-1.5">
				{emoji ? (
					<span aria-hidden="true" className="leading-none">
						{emoji}
					</span>
				) : null}
				{name}
			</strong>
			<span className="text-sm leading-snug text-muted">{description}</span>
			{children}
		</label>
	);
}

/** Only for what is actually going to be installed, where the caveats apply. */
function Notes({ services }: { services: ServiceMeta[] }) {
	const withNotes = services.filter((svc) => svc.notes?.length > 0);
	if (withNotes.length === 0) return null;
	return (
		<section
			aria-label="Notes"
			className="flex flex-col rounded-lg bg-card px-6 pb-2 pt-4"
		>
			<h3 className="mb-1 text-lg font-bold">Notes</h3>
			{withNotes.map((svc) => (
				<div
					key={svc.id}
					className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line py-3"
				>
					<strong className="flex-[0_0_120px] text-[15px]">{svc.name}</strong>
					<ul className="min-w-0 flex-[1_1_400px] list-disc pl-[18px] text-sm leading-normal text-muted">
						{svc.notes.map((note) => (
							<li key={note}>{note}</li>
						))}
					</ul>
				</div>
			))}
		</section>
	);
}
