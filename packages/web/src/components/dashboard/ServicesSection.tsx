import type { Credentials, ServiceInfo } from "../../api/client";
import type { CopyCredentials } from "../../hooks/useCopyCredentials";
import type { ServiceActions } from "../../hooks/useServiceActions";
import { ServiceCard } from "./ServiceCard";

/**
 * The running stack: one card per enabled service, plus the way in to the ones
 * that are not installed yet.
 */
export function ServicesSection({
	services,
	uninstalled,
	credentials,
	actions,
	copy,
	onReconfigureAll,
	onReconfigureService,
	onAdd,
}: {
	services: ServiceInfo[];
	/** How many services are left to install — decides whether the tile shows. */
	uninstalled: number;
	credentials?: Credentials;
	actions: ServiceActions;
	copy: CopyCredentials;
	onReconfigureAll: () => void;
	onReconfigureService: (name: string) => void;
	onAdd: () => void;
}) {
	return (
		<div>
			<div className="flex items-end justify-between mb-3">
				<h2 className="text-xl font-semibold">Services</h2>
				<div className="flex items-center gap-3">
					<RunningCount
						running={services.filter((s) => s.status === "running").length}
						total={services.length}
					/>
					<button
						type="button"
						onClick={onReconfigureAll}
						className="px-3 py-1.5 text-sm text-red-400 border border-red-400/30 rounded-md hover:bg-red-400/10 transition-colors"
					>
						Reconfigure
					</button>
				</div>
			</div>

			<div className="grid items-start gap-3 sm:grid-cols-2">
				{services.map((service) => (
					<ServiceCard
						key={service.name}
						service={service}
						credentials={credentials}
						actions={actions}
						copy={copy}
						onReconfigure={() => onReconfigureService(service.name)}
					/>
				))}

				{uninstalled > 0 && (
					<button
						type="button"
						onClick={onAdd}
						// Two columns: an even count leaves it alone on a new row, where a
						// half-width box would read as a gap. Odd, and it fills the free cell.
						className={`flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-white/[0.12] text-sm text-gray-500 transition-colors hover:border-gray-500 hover:text-gray-300 ${
							services.length % 2 === 0
								? "sm:col-span-2 min-h-[3.25rem]"
								: "h-full min-h-[5rem]"
						}`}
					>
						<svg
							aria-hidden="true"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth={2}
							className="w-4 h-4"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								d="M12 4v16m8-8H4"
							/>
						</svg>
						Add service
					</button>
				)}
			</div>
		</div>
	);
}

/** Green only when it is good news — every service up. */
function RunningCount({ running, total }: { running: number; total: number }) {
	const tone =
		running === 0
			? "text-gray-500"
			: running < total
				? "text-amber-400"
				: "text-green-400";
	return (
		<span className={`font-mono text-xs ${tone}`}>
			{running}/{total} running
		</span>
	);
}
