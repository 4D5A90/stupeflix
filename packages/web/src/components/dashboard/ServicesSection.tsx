import type { CSSProperties, PointerEvent } from "react";
import type { ServiceInfo } from "../../api/client";
import { type ServiceMeta, categoryLabel } from "../../types/setup";
import { ServiceIcon, serviceHue, serviceTint } from "../ui/ServiceIcon";
import { CATEGORY_LABELS } from "./categories";
import { TONE_DOT, type Tone, rowStatus } from "./serviceStatus";

/** How loud a card's tint is: the state, said a second time in colour. */
const STATE_CLASS: Record<Tone, string> = {
	ok: "",
	warn: "",
	fail: "is-off",
	faint: "is-gone",
};

/**
 * The running stack as a grid: one card per enabled service, and picking a
 * card puts it on the billboard. A card says what it is and one word about its
 * state, and its tint says the state again; everything else is the billboard's.
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
			<ol className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-5">
				{services.map((service) => {
					const meta = registry.find((svc) => svc.id === service.name);
					const status = rowStatus(service);
					const hue = serviceHue(service.name);
					const off = status.tone === "fail";
					const gone = status.tone === "faint";
					return (
						<li key={service.name}>
							<button
								type="button"
								aria-pressed={service.name === selected}
								onClick={() => onSelect(service.name)}
								onPointerMove={followSheen}
								className={`tint-card ${STATE_CLASS[status.tone]} relative flex h-[104px] w-full flex-col items-start justify-between overflow-hidden rounded-[10px] px-4 py-3.5 text-left`}
								style={
									{
										"--h": hue ?? 0,
										"--c": hue === null ? 0 : 1,
									} as CSSProperties
								}
							>
								<span aria-hidden="true" className="tile-sheen" />
								{/* The glyph as a watermark, cut by the corner. */}
								<span
									className={`pointer-events-none absolute -bottom-[18px] -right-3.5 h-[110px] w-[110px] ${off ? "opacity-[0.12] saturate-[0.15]" : "opacity-[0.3]"}`}
									style={{ color: serviceTint(service.name).color }}
								>
									<ServiceIcon id={service.name} size="fill" />
								</span>
								<span className="relative flex min-w-0 max-w-full flex-col gap-0.5">
									<span
										className={`truncate text-[17px] font-bold ${off || gone ? "text-muted" : ""}`}
									>
										{service.label ?? service.name}
									</span>
									{meta ? (
										<span
											className={`truncate text-[13px] ${off ? "text-faint" : gone ? "text-muted" : "text-fg/65"}`}
										>
											{categoryLabel(meta.category, CATEGORY_LABELS)}
										</span>
									) : null}
								</span>
								{/* A glass pill, colour only in the dot, so a stack that is all
								    up is not a wall of green. One width for every word, the word
								    centred in it. */}
								<span
									className={`relative flex w-[5.5rem] flex-none items-center justify-center gap-1.5 rounded-full py-[5px] px-2 text-xs font-semibold leading-none shadow-[inset_0_1px_0_rgb(var(--fg)/0.13),inset_0_0_0_1px_rgb(var(--fg)/0.08)] ${gone ? "" : "bg-fg/[0.07]"} ${status.tone === "faint" ? "text-muted" : "text-fg"}`}
								>
									<span
										aria-hidden="true"
										className={`h-[7px] w-[7px] flex-none rounded-full ${TONE_DOT[status.tone]}`}
									/>
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

/** Where the pointer is on the card, for the sheen that follows it. */
function followSheen(e: PointerEvent<HTMLElement>) {
	const r = e.currentTarget.getBoundingClientRect();
	e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
	e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
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
