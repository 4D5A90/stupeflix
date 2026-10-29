import { useQueryClient } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { useRef, useState } from "react";
import { api } from "../../api/client";
import type { Credentials, ServiceInfo } from "../../api/client";
import type { CopyCredentials } from "../../hooks/useCopyCredentials";
import type { ServiceActions } from "../../hooks/useServiceActions";
import { ActionIcon } from "../ui/ActionIcon";
import { Button, buttonClass } from "../ui/Button";
import { Collapse } from "../ui/Collapse";
import { ServiceIcon, serviceHue, serviceTint } from "../ui/ServiceIcon";
import { ServiceInfoRow } from "./ServiceInfoRow";
import { ServiceMenu } from "./ServiceMenu";
import { conditions } from "./serviceStatus";

/**
 * The selected service, large: what it is, whether its container runs, what it
 * reports about itself, and the handful of things you can do to it. Selecting
 * another row swaps it — the stack is not the main thing here, a service is.
 */
export function Billboard({
	service,
	credentials,
	actions,
	copy,
	notes,
	onReconfigure,
}: {
	service: ServiceInfo;
	credentials?: Credentials;
	actions: ServiceActions;
	copy: CopyCredentials;
	/** The template's notes, behind Help in the ⋯ menu. */
	notes: string[];
	onReconfigure: () => void;
}) {
	const queryClient = useQueryClient();
	const { ranAction, runningAction, runAction } = actions;
	const { copied, copyPassword } = copy;
	const [restarting, setRestarting] = useState(false);
	// Keyed by service, so picking another row closes it without an effect
	const [helpFor, setHelpFor] = useState<string | null>(null);

	const label = service.label ?? service.name;
	const flags = conditions(service);
	const down = service.status === "exited";
	const hue = serviceHue(service.name);
	// `--fh` transitions as a plain number, so it is carried unwrapped: 340 →
	// 25 goes on to 385 (which hsl() reads as 25) instead of sweeping back
	// through every hue between. A full-colour logo keeps the last hue and
	// fades the halo out. Idempotent, so a second render changes nothing.
	const haloHue = useRef(hue ?? 0);
	if (hue !== null) haloHue.current = nearestTurn(haloHue.current, hue);
	// A headless service declares no port, so there is nothing to open.
	//
	// The host comes from the page, not from a constant: a service is reachable
	// wherever the dashboard was reached — localhost from this machine, the LAN
	// address from another one. Hardcoding `localhost` sent every remote browser
	// to itself, so the link was dead from any other computer.
	//
	// The scheme stays http: the services publish plain ports, and borrowing an
	// https page's scheme would point at a port that speaks no TLS.
	const url = service.port
		? `http://${window.location.hostname}:${service.port}${service.webUiPath ?? ""}`
		: null;
	const secret =
		credentials?.[service.name]?.pass ?? credentials?.[service.name]?.token;
	const refresh = () => {
		queryClient.invalidateQueries({ queryKey: ["services"] });
		queryClient.invalidateQueries({ queryKey: ["registry"] });
	};

	const restart = async () => {
		setRestarting(true);
		try {
			await api.restartService(service.name);
			refresh();
		} finally {
			setRestarting(false);
		}
	};

	return (
		<section
			aria-live="polite"
			aria-label={label}
			className="relative flex items-end bg-stage lg:-mt-[72px] lg:pb-16 lg:pt-[72px]"
		>
			{/* The service's own hue as a glow. A full-colour logo has none, and
			    a stopped service dims it, as it dims the glyph. */}
			<div
				aria-hidden="true"
				className={`billboard-halo pointer-events-none absolute inset-0 ${hue === null ? "opacity-0" : down ? "opacity-30" : ""}`}
				style={{ "--fh": haloHue.current } as CSSProperties}
			/>
			{/* A watermark, not a poster: the glyph faint, taller than the
			    billboard, its tip kept clear of the browser's top edge. Decoration only — it hides at
			    phone width rather than sit under the text. The bottom is left
			    open: the page's glass (Dashboard) slides over it and fades it,
			    where a crop drew a line through the glass. The crop is its own
			    box, not the section's, so the ⋯ menu can spill out below. */}
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 hidden [clip-path:inset(0_0_-50%_0)] lg:block"
			>
				<div
					className={`absolute right-[20%] top-6 h-[20rem] w-[20rem] ${down ? "opacity-[0.08]" : "opacity-20"}`}
					style={{ color: serviceTint(service.name).color }}
				>
					<ServiceIcon id={service.name} size="fill" />
				</div>
			</div>

			<div className="relative flex max-w-[640px] flex-col gap-2.5 px-[4%] pb-8 pt-7">
				<h1 className="text-5xl font-black leading-none tracking-[-0.02em]">
					{label}
				</h1>
				{/* No status word: the selected row beside it already says it. What
				    the service reports about itself is the line's only content. The
				    line is kept, one line high, for a service with nothing to
				    report: picking another card must not move the buttons. */}
				<div className="flex min-h-[1lh] flex-wrap gap-x-3.5 gap-y-1.5 text-[15px] text-muted">
					<ServiceInfoRow service={service} />
				</div>
				{/* Why it is not right, in the template's words — the row can only
				    say "Unhealthy". */}
				{flags.map((c) =>
					c.reason ? (
						<p key={c.word} className="text-[15px] text-warn">
							{c.reason}
						</p>
					) : null,
				)}

				<div className="mt-1.5 flex flex-wrap gap-2">
					{down ? (
						<Button size="md" onClick={restart} disabled={restarting}>
							{restarting ? "Restarting…" : "Restart"}
						</Button>
					) : null}
					{url && !down ? (
						<a
							href={url}
							target="_blank"
							rel="noopener noreferrer"
							className={`${buttonClass("solid", "md")} pl-4 pr-5`}
						>
							<svg
								aria-hidden="true"
								viewBox="0 0 24 24"
								fill="currentColor"
								className="h-5 w-5"
							>
								<path d="M7 4.5v15l13-7.5z" />
							</svg>
							Open
						</a>
					) : null}
					{service.actions?.map((action) => {
						const key = `${service.name}:${action.id}`;
						const running = runningAction === key;
						return (
							<Button
								key={key}
								variant="secondary"
								size="md"
								onClick={() => runAction(service.name, action.id)}
								disabled={running}
							>
								{ranAction === key ? (
									<>
										<ActionIcon name="check" className="h-5 w-5 text-ok" />
										Done
									</>
								) : (
									<>
										<ActionIcon
											name={action.icon}
											className={`h-5 w-5 ${running ? (action.icon === "refresh" ? "animate-spin" : "animate-pulse") : ""}`}
										/>
										{action.label}
									</>
								)}
							</Button>
						);
					})}
					{secret ? (
						<Button
							variant="secondary"
							size="md"
							onClick={() => copyPassword(service.name)}
							title="Copy credentials"
						>
							<ActionIcon
								name={copied === service.name ? "check" : "key"}
								className={`h-5 w-5 ${copied === service.name ? "text-ok" : ""}`}
							/>
							{copied === service.name ? "Copied" : "Credentials"}
						</Button>
					) : null}
					<ServiceMenu
						name={service.name}
						label={label}
						onReconfigure={onReconfigure}
						onHelp={
							notes.length > 0 ? () => setHelpFor(service.name) : undefined
						}
						onChanged={refresh}
					/>
				</div>

				{/* The template's notes, for once the service runs: how to connect
				    to it, what it will not do by itself. Under the buttons rather
				    than in a dialog, so Open and Credentials stay usable while you
				    read. */}
				<Collapse open={helpFor === service.name} className="pt-2">
					<div className="relative rounded-lg bg-fg/[0.06] py-3.5 pl-4 pr-11 shadow-[inset_0_0_0_1px_rgb(var(--fg)/0.08)]">
						<button
							type="button"
							aria-label="Close help"
							onClick={() => setHelpFor(null)}
							className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-fg/10 hover:text-fg"
						>
							<svg
								aria-hidden="true"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth={2}
								strokeLinecap="round"
								className="h-4 w-4"
							>
								<path d="M6 6l12 12M18 6L6 18" />
							</svg>
						</button>
						<ul className="list-disc space-y-1.5 pl-[18px] text-sm leading-normal text-muted">
							{notes.map((note) => (
								<li key={note}>{note}</li>
							))}
						</ul>
					</div>
				</Collapse>
			</div>
		</section>
	);
}

/** `next` as the turn of the wheel nearest `from`, at most 180° away. */
function nearestTurn(from: number, next: number): number {
	return from + ((((next - from) % 360) + 540) % 360) - 180;
}
