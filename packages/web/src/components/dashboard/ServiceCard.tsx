import { useQueryClient } from "@tanstack/react-query";
import type { Credentials, ServiceInfo } from "../../api/client";
import type { CopyCredentials } from "../../hooks/useCopyCredentials";
import type { ServiceActions } from "../../hooks/useServiceActions";
import { ActionIcon } from "../ui/ActionIcon";
import { ServiceIcon, serviceTint } from "../ui/ServiceIcon";
import { ServiceInfoRow } from "./ServiceInfoRow";
import { ServiceMenu } from "./ServiceMenu";

const statusStyles: Record<
	string,
	{ dot: string; text: string; pill: string }
> = {
	running: {
		dot: "bg-green-500",
		text: "running",
		pill: "bg-green-500/10 text-green-400",
	},
	restarting: {
		dot: "bg-amber-500",
		text: "restarting",
		pill: "bg-amber-500/10 text-amber-400",
	},
	exited: {
		dot: "bg-red-500",
		text: "exited",
		pill: "bg-red-500/10 text-red-400",
	},
	not_found: {
		dot: "bg-gray-500",
		text: "missing",
		pill: "bg-gray-500/15 text-gray-400",
	},
};

/**
 * One service, as the dashboard sees it: what it is, whether its container runs,
 * what it reports about itself, and the handful of things you can do to it.
 */
export function ServiceCard({
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

	const style = statusStyles[service.status] ?? statusStyles.not_found;
	const label = service.label ?? service.name;
	// A headless service declares no port, so there is nothing to open
	const url = service.port
		? `http://localhost:${service.port}${service.webUiPath ?? ""}`
		: null;
	const secret =
		credentials?.[service.name]?.pass ?? credentials?.[service.name]?.token;
	const hasFooter =
		(service.actions?.length ?? 0) > 0 || Boolean(secret) || Boolean(url);

	return (
		<div className="flex flex-col bg-ink-800 border border-white/[0.07] rounded-lg">
			<div className="flex items-center gap-3 px-3.5 py-3">
				<div
					className="w-9 h-9 shrink-0 grid place-items-center rounded-md"
					style={serviceTint(service.name)}
				>
					<ServiceIcon id={service.name} />
				</div>
				<div className="flex-1 min-w-0">
					<span className="text-white font-semibold truncate">{label}</span>
				</div>
				<div className="flex items-center gap-2.5">
					<span
						className={`inline-flex h-6 items-center gap-1.5 px-2.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${style.pill}`}
					>
						<span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
						{style.text}
					</span>
					<ServiceMenu
						name={service.name}
						label={label}
						onReconfigure={onReconfigure}
						onChanged={() => {
							queryClient.invalidateQueries({
								queryKey: ["services"],
							});
							queryClient.invalidateQueries({
								queryKey: ["registry"],
							});
						}}
					/>
				</div>
			</div>

			<ServiceInfoRow service={service} />

			{/* A headless service with no declared action has nothing to put
			    here, and an empty bordered strip reads as a rendering bug */}
			<div
				className={`flex border-t border-white/[0.07] text-xs ${hasFooter ? "" : "hidden"}`}
			>
				{service.actions?.map((action) => {
					const key = `${service.name}:${action.id}`;
					const running = runningAction === key;
					return (
						<button
							key={key}
							type="button"
							onClick={() => runAction(service.name, action.id)}
							disabled={running}
							title={action.label}
							className="flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2 px-1 text-gray-400 border-r border-white/[0.07] last:border-r-0 first:rounded-bl-lg last:rounded-br-lg hover:text-brand-400 hover:bg-white/[0.03] transition-colors disabled:opacity-50"
						>
							{ranAction === key ? (
								<>
									<ActionIcon
										name="check"
										className="w-3.5 h-3.5 shrink-0 text-green-400"
									/>
									<span className="truncate text-green-400">Done</span>
								</>
							) : (
								<>
									<ActionIcon
										name={action.icon}
										className={`w-3.5 h-3.5 shrink-0 ${running ? (action.icon === "refresh" ? "animate-spin" : "animate-pulse") : ""}`}
									/>
									<span className="truncate">{action.label}</span>
								</>
							)}
						</button>
					);
				})}

				{secret ? (
					<button
						type="button"
						onClick={() => copyPassword(service.name)}
						title="Copy credentials"
						className="flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2 px-1 text-gray-400 border-r border-white/[0.07] last:border-r-0 first:rounded-bl-lg last:rounded-br-lg hover:text-brand-400 hover:bg-white/[0.03] transition-colors"
					>
						<ActionIcon
							name={copied === service.name ? "check" : "key"}
							className={`w-3.5 h-3.5 shrink-0 ${copied === service.name ? "text-green-400" : ""}`}
						/>
						<span
							className={`truncate ${copied === service.name ? "text-green-400" : ""}`}
						>
							{copied === service.name ? "Copied" : "Credentials"}
						</span>
					</button>
				) : null}

				{url ? (
					<a
						href={url}
						target="_blank"
						rel="noopener noreferrer"
						title={`Open ${label}`}
						className="flex-1 min-w-0 flex items-center justify-center gap-1.5 py-2 px-1 text-gray-400 border-r border-white/[0.07] last:border-r-0 first:rounded-bl-lg last:rounded-br-lg hover:text-brand-400 hover:bg-white/[0.03] transition-colors"
					>
						<ActionIcon name="open" className="w-3.5 h-3.5 shrink-0" />
						<span className="truncate">Open</span>
					</a>
				) : null}
			</div>
		</div>
	);
}
