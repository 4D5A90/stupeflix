import type { ButtonHTMLAttributes } from "react";

/**
 * - `primary` is the accent, and only for the next step.
 * - `secondary` is the translucent grey that sits on the billboard's black.
 * - `solid` is the foreground as a fill: white on the dark mode, near-black on
 *   the light one — Open on the billboard, Copy in Settings.
 * - `outline` and `ghost` are everything else.
 */
export type ButtonVariant =
	| "primary"
	| "secondary"
	| "solid"
	| "outline"
	| "ghost";

/** 36 in the top bar, 40 for page actions, 48 on the billboard. */
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
	primary:
		"bg-accent text-white hover:bg-accent-hover active:bg-accent-pressed",
	secondary: "bg-secondary text-white hover:brightness-125",
	solid: "bg-fg text-card hover:bg-fg/80",
	outline: "border border-fg text-fg hover:bg-fg/[0.06]",
	ghost: "text-fg hover:bg-fg/10",
};

const SIZES: Record<ButtonSize, string> = {
	sm: "h-9 px-3.5 text-sm gap-2",
	md: "h-10 px-[18px] text-[15px] gap-2",
	lg: "h-12 px-5 text-lg gap-2.5",
};

/** The same look on an `<a>` or a `<label>`, which cannot be a `<button>`. */
export function buttonClass(
	variant: ButtonVariant = "primary",
	size: ButtonSize = "md",
): string {
	return `inline-flex shrink-0 items-center justify-center rounded font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${SIZES[size]}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
	size?: ButtonSize;
}

export function Button({
	variant = "primary",
	size = "md",
	className = "",
	type = "button",
	...props
}: ButtonProps) {
	return (
		<button
			type={type}
			className={`${buttonClass(variant, size)} ${className}`}
			{...props}
		/>
	);
}
