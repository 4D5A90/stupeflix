import type { SelectHTMLAttributes } from "react";
import { fieldClass } from "./Input";

export interface SelectOption {
	value: string;
	label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
	label: string;
	options: SelectOption[];
}

/**
 * A native `<select>` on purpose: it is already type-to-search on every
 * platform, keyboard-accessible for free, and renders as the platform expects.
 * A custom combobox would be a lot of code for a list this size.
 */
export function Select({
	label,
	options,
	className = "",
	...props
}: SelectProps) {
	return (
		<label className="flex flex-col gap-1.5">
			<span className="text-sm font-bold">{label}</span>
			<select
				className={`${fieldClass({ select: true })} ${className}`}
				{...props}
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</label>
	);
}
