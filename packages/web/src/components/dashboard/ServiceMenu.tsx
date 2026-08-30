import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { ActionIcon } from "../ui/ActionIcon";

/**
 * Lifecycle actions live on the status pill, not in the card's footer: the
 * footer holds what the *service* can do (its template declares those), while
 * these act on the container itself. Two kinds of verb, two places.
 */
export function ServiceMenu({
	name,
	label,
	onReconfigure,
	onChanged,
}: {
	name: string;
	label: string;
	onReconfigure: () => void;
	onChanged: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [confirmingRemove, setConfirmingRemove] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);
	const wrapper = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) =>
			e.key === "Escape" && setOpen(false);
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	// Arming the confirmation must not outlive the menu it lives in
	useEffect(() => {
		if (!open) setConfirmingRemove(false);
	}, [open]);

	const run = async (kind: string, fn: () => Promise<unknown>) => {
		setBusy(kind);
		try {
			await fn();
			onChanged();
			setOpen(false);
		} finally {
			setBusy(null);
		}
	};

	const item =
		"flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-300 hover:bg-white/[0.05] transition-colors disabled:opacity-50";

	return (
		<div className="relative" ref={wrapper}>
			<button
				type="button"
				aria-label={`${label} — actions`}
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="grid h-6 w-7 place-items-center rounded-md border border-white/[0.12] text-gray-400 hover:border-gray-500 hover:bg-white/[0.05] hover:text-gray-200 transition-colors"
			>
				<svg
					aria-hidden="true"
					viewBox="0 0 24 24"
					fill="currentColor"
					className="h-4 w-4"
				>
					<circle cx="5" cy="12" r="1.6" />
					<circle cx="12" cy="12" r="1.6" />
					<circle cx="19" cy="12" r="1.6" />
				</svg>
			</button>

			{open ? (
				<div className="absolute right-0 top-7 z-20 w-44 overflow-hidden rounded-md border border-white/[0.12] bg-ink-950 py-1 shadow-xl">
					<button
						type="button"
						disabled={busy !== null}
						onClick={() => run("restart", () => api.restartService(name))}
						className={item}
					>
						<ActionIcon
							name="refresh"
							className={`h-3.5 w-3.5 ${busy === "restart" ? "animate-spin" : ""}`}
						/>
						{busy === "restart" ? "Restarting…" : "Restart"}
					</button>

					<button
						type="button"
						disabled={busy !== null}
						onClick={() => {
							setOpen(false);
							onReconfigure();
						}}
						className={item}
					>
						<ActionIcon name="cog" className="h-3.5 w-3.5" />
						Reconfigure
					</button>

					<div className="my-1 border-t border-white/[0.07]" />

					{/* The only irreversible item here, so it asks twice */}
					<button
						type="button"
						disabled={busy !== null}
						onClick={() =>
							confirmingRemove
								? run("remove", () => api.deleteService(name))
								: setConfirmingRemove(true)
						}
						className={`${item} ${confirmingRemove ? "text-red-300 bg-red-500/10" : "text-red-400"}`}
					>
						<ActionIcon name="trash" className="h-3.5 w-3.5" />
						{busy === "remove"
							? "Removing…"
							: confirmingRemove
								? "Confirm remove"
								: "Remove"}
					</button>

					{confirmingRemove ? (
						<p className="px-3 pb-1.5 pt-0.5 text-[10px] leading-snug text-gray-500">
							Containers only — settings under config/ are kept.
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}
