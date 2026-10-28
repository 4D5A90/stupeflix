import type { StepId } from "../types/setup";
import { navItemClass } from "./ui/NavLayout";

const STEPS: { id: StepId; label: string }[] = [
	// The step holds what is asked once and shared by every service — paths,
	// libraries, the address. Not "whatever has no other home": a field earns its
	// place here by being reused downstream, and the id stays `paths` on purpose,
	// since it keys nothing the user reads.
	{ id: "paths", label: "General" },
	{ id: "services", label: "Services" },
	{ id: "credentials", label: "Credentials" },
	{ id: "progress", label: "Setup" },
];

interface StepNavProps {
	current: StepId;
	/** Once the run has started, no other step can be reached. */
	locked: boolean;
	/** The run finished: every step is ticked, the current one included. */
	done: boolean;
	onGo: (step: StepId) => void;
}

/**
 * The wizard's left column. A step already passed is a way back to it; the
 * ones ahead are shown but not reachable, since each depends on the last.
 */
export function StepNav({ current, locked, done, onGo }: StepNavProps) {
	const currentIndex = STEPS.findIndex((s) => s.id === current);

	return STEPS.map((step, index) => {
		const isCurrent = index === currentIndex;
		const ticked = index < currentIndex || done;
		const reachable = locked ? isCurrent : index <= currentIndex;
		return (
			<button
				key={step.id}
				type="button"
				aria-current={isCurrent ? "step" : undefined}
				disabled={!reachable}
				onClick={() => onGo(step.id)}
				// Every step listens for Enter on the window to mean Next. Enter on
				// this button already means "go here", so it must not reach them —
				// one key would otherwise move forward and back at once.
				onKeyDown={(e) => {
					if (e.key === "Enter") e.stopPropagation();
				}}
				className={navItemClass(isCurrent)}
			>
				<span
					aria-hidden="true"
					className={`grid h-[26px] w-[26px] flex-none place-items-center rounded-full text-[13px] font-bold ${
						ticked
							? "bg-ok text-white"
							: isCurrent
								? "bg-fg text-card"
								: "border-[1.5px] border-faint text-muted"
					}`}
				>
					{ticked ? "✓" : index + 1}
				</span>
				{step.label}
			</button>
		);
	});
}
