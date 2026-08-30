import { type ReactNode, useState } from "react";

interface AccordionProps {
	label: string;
	summary: string;
	children: ReactNode;
	defaultOpen?: boolean;
	small?: boolean;
}

export function Accordion({
	label,
	summary,
	children,
	defaultOpen = false,
	small,
}: AccordionProps) {
	const [open, setOpen] = useState(defaultOpen);

	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center justify-between w-full text-left"
			>
				<div className="flex items-center gap-2">
					<span
						className={
							small ? "text-xs text-gray-400" : "text-gray-300 font-medium"
						}
					>
						{label}
					</span>
					{!open ? (
						<span
							className={
								small ? "text-xs text-gray-600" : "text-sm text-gray-500"
							}
						>
							{summary}
						</span>
					) : null}
				</div>
				<svg
					aria-hidden="true"
					className={`${small ? "w-3 h-3" : "w-4 h-4"} text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					strokeWidth={2}
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						d="M19 9l-7 7-7-7"
					/>
				</svg>
			</button>
			{open ? (
				<div className={small ? "mt-1.5" : "mt-2"}>{children}</div>
			) : null}
		</div>
	);
}
