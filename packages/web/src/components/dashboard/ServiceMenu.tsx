import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { ActionIcon } from "../ui/ActionIcon";

/**
 * Lifecycle actions live behind the round ⋯, not among the billboard's
 * buttons: those hold what the *service* can do (its template declares them),
 * while these act on the container itself. Two kinds of verb, two places.
 */
export function ServiceMenu({
	name,
	label,
	onReconfigure,
	onHelp,
	onChanged,
}: {
	name: string;
	label: string;
	onReconfigure: () => void;
	/** Shows the template's notes; absent when it has none. */
	onHelp?: () => void;
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
		"flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[15px] text-fg hover:bg-fg/10 transition-colors disabled:opacity-50";

	return (
		<div className="relative" ref={wrapper}>
			<button
				type="button"
				aria-label={`${label} — actions`}
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="grid h-10 w-10 place-items-center rounded-full border-2 border-faint text-fg transition-colors hover:border-fg"
			>
				<svg
					aria-hidden="true"
					viewBox="0 0 24 24"
					fill="currentColor"
					className="h-[18px] w-[18px]"
				>
					<circle cx="5" cy="12" r="1.8" />
					<circle cx="12" cy="12" r="1.8" />
					<circle cx="19" cy="12" r="1.8" />
				</svg>
			</button>

			{open ? (
				<div className="absolute left-0 top-12 z-20 w-56 overflow-hidden rounded border border-line bg-card py-1">
					<button
						type="button"
						disabled={busy !== null}
						onClick={() => run("restart", () => api.restartService(name))}
						className={item}
					>
						<ActionIcon
							name="refresh"
							className={`h-4 w-4 ${busy === "restart" ? "animate-spin" : ""}`}
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
						<ActionIcon name="cog" className="h-4 w-4" />
						Reconfigure
					</button>

					{onHelp ? (
						<button
							type="button"
							onClick={() => {
								setOpen(false);
								onHelp();
							}}
							className={item}
						>
							<svg
								aria-hidden="true"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth={2}
								strokeLinecap="round"
								strokeLinejoin="round"
								className="h-4 w-4"
							>
								<circle cx="12" cy="12" r="9" />
								<path d="M12 11v5M12 8h.01" />
							</svg>
							Help
						</button>
					) : null}

					<div className="my-1 border-t border-line" />

					{/* The only irreversible item here, so it asks twice */}
					<button
						type="button"
						disabled={busy !== null}
						onClick={() =>
							confirmingRemove
								? run("remove", () => api.deleteService(name))
								: setConfirmingRemove(true)
						}
						className={`${item} text-fail ${confirmingRemove ? "bg-fail-bg" : ""}`}
					>
						<ActionIcon name="trash" className="h-4 w-4" />
						{busy === "remove"
							? "Removing…"
							: confirmingRemove
								? "Confirm remove"
								: "Remove"}
					</button>

					{confirmingRemove ? (
						<p className="px-4 pb-2 pt-0.5 text-[13px] leading-snug text-muted">
							Containers only — settings under config/ are kept.
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}
