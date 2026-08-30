import type { InputHTMLAttributes, ReactNode } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
	label: string;
}

const URL_REGEX = /([\w-]+\.(?:com|org|net|io|tv|dev)(?:\/[\w-]*)*)/g;

function renderLabel(label: string): ReactNode {
	// The key carries the position as text: the split is a pure function of
	// `label`, so a part never moves without the whole list being rebuilt.
	const parts = label
		.split(URL_REGEX)
		.map((text, i) => ({ key: `${i}:${text}`, text }));
	if (parts.length === 1) return label;
	return parts.map(({ key, text }) =>
		URL_REGEX.test(text) ? (
			<a
				key={key}
				href={`https://${text}`}
				target="_blank"
				rel="noopener noreferrer"
				className="text-brand-400 hover:underline"
				onClick={(e) => e.stopPropagation()}
			>
				{text}
			</a>
		) : (
			<span key={key}>{text}</span>
		),
	);
}

export function Input({ label, className = "", ...props }: InputProps) {
	return (
		<label className="block">
			<span className="text-sm text-gray-400">{renderLabel(label)}</span>
			<input
				className={`mt-1 block w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent ${className}`}
				{...props}
			/>
		</label>
	);
}
