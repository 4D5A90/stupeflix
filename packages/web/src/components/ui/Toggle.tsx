interface ToggleProps {
	label: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
}

export function Toggle({ label, checked, onChange }: ToggleProps) {
	return (
		// A <label> would associate nothing: the switch is a button, not a form
		// control, so it carries its own name instead.
		<div className="flex items-center justify-between cursor-pointer">
			<span className="text-gray-100">{label}</span>
			<button
				type="button"
				role="switch"
				aria-label={label}
				aria-checked={checked}
				onClick={() => onChange(!checked)}
				className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
					checked ? "bg-brand-600" : "bg-gray-700"
				}`}
			>
				<span
					className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
						checked ? "translate-x-6" : "translate-x-1"
					}`}
				/>
			</button>
		</div>
	);
}
