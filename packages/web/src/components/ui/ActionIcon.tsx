import type { ReactNode } from "react";

/**
 * Icons a template may name in an action's `icon:` field. Keys are
 * case-sensitive and documented in the README — keep the two in step.
 */
const icons: Record<string, ReactNode> = {
  refresh: (
    <path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M21.015 4.357v4.992" />
  ),
  play: <path d="M5 3l14 9-14 9V3z" />,
  stop: <path d="M6 6h12v12H6z" />,
  power: <path d="M12 3v9m6.36-5.36a9 9 0 11-12.72 0" />,
  download: <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />,
  upload: <path d="M12 21V9m0 0l-4 4m4-4l4 4M4 7V5a2 2 0 012-2h12a2 2 0 012 2v2" />,
  trash: <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 13a1 1 0 001 1h6a1 1 0 001-1l1-13" />,
  search: <path d="M11 17a6 6 0 100-12 6 6 0 000 12zm9 3l-4.5-4.5" />,
  check: <path d="M5 13l4 4L19 7" />,
  wrench: (
    <path d="M14.7 6.3a4 4 0 01-5 5L4 17v3h3l5.7-5.7a4 4 0 015-5l-2.4-2.4 2.1-2.1a4 4 0 00-2.7 1.5z" />
  ),
};

/** Shown when a template names no icon, or names one that does not exist. */
const defaultIcon = <path d="M13 2L4.09 12.97a1 1 0 00.77 1.64H11l-1 7.39 8.91-10.97a1 1 0 00-.77-1.64H12l1-7.39z" />;

export function ActionIcon({
  name,
  className,
}: {
  name?: string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {(name && icons[name]) ?? defaultIcon}
    </svg>
  );
}
