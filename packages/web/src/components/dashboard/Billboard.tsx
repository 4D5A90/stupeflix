import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api/client";
import type { Credentials, ServiceInfo } from "../../api/client";
import type { CopyCredentials } from "../../hooks/useCopyCredentials";
import type { ServiceActions } from "../../hooks/useServiceActions";
import { ActionIcon } from "../ui/ActionIcon";
import { Button, buttonClass } from "../ui/Button";
import { ServiceIcon, serviceTint } from "../ui/ServiceIcon";
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
	onReconfigure,
}: {
	service: ServiceInfo;
	credentials?: Credentials;
	actions: ServiceActions;
	copy: CopyCredentials;
	onReconfigure: () => void;
}) {
	const queryClient = useQueryClient();
	const { ranAction, runningAction, runAction } = actions;
	const { copied, copyPassword } = copy;
	const [restarting, setRestarting] = useState(false);

	const label = service.label ?? service.name;
	const flags = conditions(service);
	const down = service.status === "exited";
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
					className={`absolute right-[20%] top-6 h-[20rem] w-[20rem] ${down ? "opacity-5" : "opacity-10"}`}
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
				    the service reports about itself is the line's only content. */}
				{service.info?.length ? (
					<div className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[15px] text-muted">
						<ServiceInfoRow service={service} />
					</div>
				) : null}
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
						onChanged={refresh}
					/>
				</div>
			</div>
		</section>
	);
}
