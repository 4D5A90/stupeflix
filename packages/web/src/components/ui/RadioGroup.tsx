interface RadioOption {
	value: string;
	label: string;
	description?: string;
}

interface RadioGroupProps {
	label: string;
	options: RadioOption[];
	value: string;
	onChange: (value: string) => void;
}

export function RadioGroup({
	label,
	options,
	value,
	onChange,
}: RadioGroupProps) {
	return (
		<div className="space-y-2">
			{label ? <span className="font-bold">{label}</span> : null}
			<div className="grid grid-cols-1 gap-2">
				{options.map((option) => {
					const selected = option.value === value;
					return (
						<button
							key={option.value}
							type="button"
							onClick={() => onChange(option.value)}
							className={`flex items-center gap-3 rounded-lg border-2 bg-card px-4 py-3 text-left transition-colors ${
								selected ? "border-fg" : "border-transparent hover:border-line"
							}`}
						>
							<div
								className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
									selected ? "border-fg" : "border-faint"
								}`}
							>
								{selected ? (
									<div className="w-2 h-2 rounded-full bg-fg" />
								) : null}
							</div>
							<div>
								<span className="font-bold">{option.label}</span>
								{option.description ? (
									<p className="text-sm text-muted">{option.description}</p>
								) : null}
							</div>
						</button>
					);
				})}
			</div>
		</div>
	);
}
