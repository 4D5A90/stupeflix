interface SwitchProps {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}

/**
 * The switch alone, for a caller that lays its own label out — the wizard's
 * Base Path sits in a label column with the switch beside it.
 */
export function Switch({ label, checked, onChange }: SwitchProps) {
	return (
		<button
			type="button"
			role="switch"
			aria-label={label}
			aria-checked={checked}
			onClick={() => onChange(!checked)}
			// shrink-0: a long label beside it must wrap rather than squeeze the
			// track, whose knob is offset for a full 40px
			className={`relative inline-flex h-[22px] w-10 shrink-0 items-center rounded-full transition-colors ${
				checked ? "bg-fg" : "bg-track"
			}`}
		>
			<span
				className={`inline-block h-4 w-4 transform rounded-full bg-card transition-transform ${
					checked ? "translate-x-[21px]" : "translate-x-[3px]"
				}`}
			/>
		</button>
	);
}

export function Toggle({ label, checked, onChange }: SwitchProps) {
	return (
		// A <label> would associate nothing: the switch is a button, not a form
		// control, so it carries its own name instead.
		<div className="flex items-center justify-between gap-3">
			<span className="min-w-0 font-bold">{label}</span>
			<Switch label={label} checked={checked} onChange={onChange} />
		</div>
	);
}
