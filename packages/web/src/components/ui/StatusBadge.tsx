import type { StepStatus } from "../../types/setup";

interface StatusBadgeProps {
	status: StepStatus;
	label: string;
	small?: boolean;
}

const statusStyles: Record<
	StepStatus,
	{ bg: string; text: string; icon: string }
> = {
	pending: { bg: "bg-card", text: "text-muted", icon: "○" },
	in_progress: { bg: "bg-card", text: "text-fg font-bold", icon: "◔" },
	completed: { bg: "bg-card", text: "text-ok", icon: "✓" },
	// Reads as done, because it is: only the caller that cares knows nothing was
	// sent for this one.
	skipped: { bg: "bg-card", text: "text-ok", icon: "✓" },
	failed: { bg: "bg-fail-bg", text: "text-fail font-bold", icon: "✗" },
};

export function StatusBadge({ status, label, small }: StatusBadgeProps) {
	const style = statusStyles[status];

	if (small) {
		return (
			<div className="flex items-center gap-2 py-0.5">
				<span className={`${style.text} text-xs`}>{style.icon}</span>
				<span className={`${style.text} text-sm`}>{label}</span>
			</div>
		);
	}

	return (
		<div className={`flex items-center gap-2 rounded px-4 py-3 ${style.bg}`}>
			<span className={`${style.text} text-lg`}>{style.icon}</span>
			<span className={style.text}>{label}</span>
		</div>
	);
}
