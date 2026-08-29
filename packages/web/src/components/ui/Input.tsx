import type { InputHTMLAttributes, ReactNode } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

const URL_REGEX = /([\w-]+\.(?:com|org|net|io|tv|dev)(?:\/[\w-]*)*)/g;

function renderLabel(label: string): ReactNode {
  const parts = label.split(URL_REGEX);
  if (parts.length === 1) return label;
  return parts.map((part, i) =>
    URL_REGEX.test(part) ? (
      <a
        key={i}
        href={`https://${part}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-brand-400 hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
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
