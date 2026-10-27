import { type InputHTMLAttributes, type ReactNode, useId } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
	label: string;
	/**
	 * Values offered as you type, through a native `datalist`. The browser draws
	 * and filters the list itself, which is why there is no dropdown component
	 * here: nothing to keep open, to close on blur, or to drive with arrow keys.
	 */
	suggestions?: string[];
	/** Draws the field as refused; the sentence saying why is the caller's. */
	error?: boolean;
	/** For paths, keys and addresses: values read character by character. */
	mono?: boolean;
}

/**
 * The field itself, shared by every text box and native `<select>` so that one
 * spelled out by hand — a library row, a credential beside its generate button
 * — still looks like the rest. Disabled reads as a value on the page ground
 * rather than a greyed-out box: it is shown, just not yours to change.
 */
export function fieldClass({
	error = false,
	mono = false,
	select = false,
}: { error?: boolean; mono?: boolean; select?: boolean } = {}): string {
	// A hairline at rest, darker under the pointer, ink once focused: the edge
	// only gets loud when the field is the one you are in.
	return `block h-11 w-full min-w-0 rounded bg-card px-3.5 text-[15px] text-fg placeholder:text-muted/70 transition-colors focus:outline-none disabled:border-transparent disabled:bg-page disabled:text-muted ${
		error
			? "border-2 border-fail"
			: "border border-field enabled:hover:border-faint focus:border-fg focus:ring-1 focus:ring-fg"
	} ${mono ? "font-mono" : ""} ${select ? "field-select" : ""}`;
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
				className="text-link hover:text-link-hover hover:underline"
				onClick={(e) => e.stopPropagation()}
			>
				{text}
			</a>
		) : (
			<span key={key}>{text}</span>
		),
	);
}

export function Input({
	label,
	className = "",
	suggestions,
	error,
	mono,
	...props
}: InputProps) {
	const listId = useId();
	const offered = suggestions?.filter(Boolean) ?? [];
	return (
		<label className="flex flex-col gap-1.5">
			<span className="text-sm font-bold">{renderLabel(label)}</span>
			<input
				className={`${fieldClass({ error, mono })} ${className}`}
				aria-invalid={error || undefined}
				list={offered.length > 0 ? listId : undefined}
				{...props}
			/>
			{offered.length > 0 ? (
				<datalist id={listId}>
					{offered.map((value) => (
						<option key={value} value={value} />
					))}
				</datalist>
			) : null}
		</label>
	);
}
