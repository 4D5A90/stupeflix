import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Library } from "../../types/setup";
import { Button } from "../ui/Button";

/** `libraries` is stored as JSON text; anything else reads as none. */
function librariesOf(raw: unknown): Library[] {
	if (typeof raw !== "string") return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

/**
 * What the wizard wrote, read back — only what `GET /settings` and
 * `GET /runtime` actually hold. The stack's name, the admin address and the
 * container's PUID/PGID/TZ are not among them, so they are not shown rather
 * than guessed.
 */
export function ConfigurationPage({
	onReconfigure,
}: {
	onReconfigure: () => void;
}) {
	const { data: settings } = useQuery({
		queryKey: ["settings"],
		queryFn: api.getSettings,
	});
	const { data: runtime } = useQuery({
		queryKey: ["runtime"],
		queryFn: api.getRuntime,
	});

	const path = (key: string) =>
		typeof settings?.[key] === "string" ? (settings[key] as string) : "";
	const libraries = librariesOf(settings?.libraries);
	const rows: { label: string; value: string; note?: string }[] = [
		// Only inside Docker: on the host nothing records a base path at all.
		...(runtime?.root
			? [
					{
						label: "Base path",
						value: runtime.root,
						note: "mounted from the host",
					},
				]
			: []),
		{ label: "Config", value: path("paths.config") },
		{
			label: "Media",
			value: path("paths.media"),
			note: libraries.map((l) => l.name).join(" · "),
		},
		{ label: "Torrents", value: path("paths.torrents") },
	];

	return (
		<>
			<h2 className="text-[32px] font-bold leading-tight">Configuration</h2>
			<section className="rounded-lg bg-card px-6 py-1">
				{rows.map((row) => (
					<div
						key={row.label}
						className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line py-[18px] first:border-t-0"
					>
						<span className="flex-[0_0_160px] font-bold">{row.label}</span>
						<span className="min-w-0 flex-[1_1_240px] break-all font-mono text-sm">
							{row.value || "—"}
						</span>
						{row.note ? (
							<span className="text-[13px] text-muted">{row.note}</span>
						) : null}
					</div>
				))}
			</section>
			<section className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-card p-6">
				<span className="flex max-w-[560px] flex-col gap-1">
					<strong className="text-lg">Reconfigure the whole stack</strong>
					{/* The truth, not the reassuring version: a whole-stack run
					    always stops the stack and drops every service's generated
					    configuration before it starts again. */}
					<span className="text-sm text-muted">
						Runs the wizard again from General. Starting it stops every
						container and resets each service's generated configuration, so the
						whole stack is set up again from scratch.
					</span>
				</span>
				<Button variant="outline" onClick={onReconfigure}>
					Reconfigure
				</Button>
			</section>
		</>
	);
}
