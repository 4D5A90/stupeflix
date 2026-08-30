import type { SelectHTMLAttributes } from "react";

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
    <label className="block">
      <span className="text-sm text-gray-400">{label}</span>
      <select
        className={`mt-1 block w-full px-3 py-2 bg-ink-950 border border-white/[0.12] rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent ${className}`}
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
