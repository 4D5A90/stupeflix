import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: "primary" | "secondary";
}

export function Button({
	variant = "primary",
	className = "",
	...props
}: ButtonProps) {
	const base =
		"px-4 py-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
	const variants = {
		primary: "bg-brand-600 hover:bg-brand-700 text-white",
		secondary: "bg-gray-700 hover:bg-gray-600 text-gray-100",
	};

	return (
		<button
			className={`${base} ${variants[variant]} ${className}`}
			{...props}
		/>
	);
}
