import type { ServiceInfo } from "../../api/client";
import { type ServiceMeta, categoryLabel } from "../../types/setup";
import { ServiceIcon, serviceTint } from "../ui/ServiceIcon";
import { CATEGORY_LABELS } from "./categories";
import { TONE_TEXT, rowStatus } from "./serviceStatus";

/**
 * The running stack as a list: one row per enabled service, and picking a row
 * puts it on the billboard. A row says what it is and one word about its
 * state; everything else is the billboard's.
 */
export function ServicesSection({
	services,
	registry,
	selected,
	onSelect,
}: {
	services: ServiceInfo[];
	registry: ServiceMeta[];
	selected?: string;
	onSelect: (name: string) => void;
}) {
	return (
		<section className="flex min-w-0 flex-[999_1_640px] flex-col gap-2">
			<div className="mb-2 flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5">
				<h2 className="text-2xl font-bold">Services</h2>
				<RunningCount
					running={services.filter((s) => s.status === "running").length}
					total={services.length}
				/>
			</div>
			<ol className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-x-4 gap-y-1">
				{services.map((service) => {
					const meta = registry.find((svc) => svc.id === service.name);
					const status = rowStatus(service);
					const picked = service.name === selected;
					return (
						<li key={service.name}>
							<button
								type="button"
								aria-pressed={picked}
								onClick={() => onSelect(service.name)}
								className={`glass-card flex w-full items-center gap-3.5 rounded-lg px-3 py-2.5 text-left transition-colors ${
									picked ? "bg-fg/[0.14]" : "hover:bg-fg/[0.05]"
								}`}
							>
								<span
									className="grid h-[63px] w-28 flex-none place-items-center rounded"
									style={serviceTint(service.name)}
								>
									<span
										className={
											service.status === "exited" ? "opacity-35" : undefined
										}
									>
										<ServiceIcon id={service.name} size="md" />
									</span>
								</span>
								<span className="flex min-w-0 flex-auto flex-col gap-[3px]">
									<span className="truncate font-bold">
										{service.label ?? service.name}
									</span>
									{meta ? (
										<span className="text-[13px] text-muted">
											{categoryLabel(meta.category, CATEGORY_LABELS)}
										</span>
									) : null}
								</span>
								<span
									className={`flex-none text-[13px] font-bold ${TONE_TEXT[status.tone]}`}
								>
									{status.word}
								</span>
							</button>
						</li>
					);
				})}
			</ol>
		</section>
	);
}

/** Green only when it is good news — every service up. */
function RunningCount({ running, total }: { running: number; total: number }) {
	const tone =
		running === 0 ? "text-faint" : running < total ? "text-warn" : "text-ok";
	return (
		<span className={`text-[15px] font-bold ${tone}`}>
			{running} of {total} running
		</span>
	);
}
