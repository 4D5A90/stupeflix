import type { TemplateSummary } from "../../api/client";
import type { TemplateCatalogue } from "../../hooks/useTemplateCatalogue";
import { ServiceIcon, serviceTint } from "../ui/ServiceIcon";
import { CATEGORY_LABELS } from "./categories";

/**
 * The catalogue behind the services: what the server has loaded, and the two
 * ways to change it. The grid is collapsed by default — it is reference
 * material, not something you act on every visit.
 *
 * State lives in `useTemplateCatalogue`, one level up: this section unmounts
 * whenever the dashboard hands over to the install or reconfigure screen.
 */
export function TemplatesSection({
	templates,
	catalogue,
}: {
	templates?: TemplateSummary[];
	catalogue: TemplateCatalogue;
}) {
	const { open, setOpen, reloaded, reload, upload } = catalogue;
	return (
		<div className="border-t border-white/[0.07] pt-6">
			{/* One row, always there: the title toggles the grid, the two actions act
			    on the catalogue whether it is shown or not. */}
			<div
				className={`flex items-center justify-between ${open ? "mb-3" : ""}`}
			>
				<button
					type="button"
					onClick={() => setOpen(!open)}
					className="group flex items-center gap-2 text-left"
				>
					<h2 className="text-xl font-semibold">Templates</h2>
					<svg
						aria-hidden="true"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth={2}
						className={`h-5 w-5 text-gray-400 transition-transform group-hover:text-gray-200 ${open ? "rotate-180" : ""}`}
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M19 9l-7 7-7-7"
						/>
					</svg>
				</button>
				<div className="flex items-center gap-2">
					<label className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 bg-ink-800 hover:bg-ink-700 rounded-md transition-colors cursor-pointer">
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
						Add
						<input
							type="file"
							accept=".yml,.yaml"
							className="hidden"
							onChange={(e) => {
								const file = e.target.files?.[0];
								if (file) upload.mutate(file);
								e.target.value = "";
							}}
						/>
					</label>
					<button
						type="button"
						onClick={() => reload.mutate()}
						disabled={reload.isPending}
						className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 bg-ink-800 hover:bg-ink-700 rounded-md transition-colors disabled:opacity-50"
					>
						<svg
							aria-hidden="true"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth={2}
							className={`w-4 h-4 ${reload.isPending ? "animate-spin" : ""}`}
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
							/>
						</svg>
						{reload.isPending
							? "Reloading…"
							: reloaded !== null
								? `Reloaded ${reloaded}`
								: "Reload"}
					</button>
				</div>
			</div>

			{open && templates ? (
				<div
					className="grid gap-2"
					style={{
						gridTemplateColumns: "repeat(auto-fill, minmax(9.5rem, 1fr))",
					}}
				>
					{templates.map((tpl) => (
						<div
							key={tpl.id}
							className="flex items-center gap-2.5 rounded-md border border-white/[0.07] bg-ink-800 px-3 py-2"
						>
							<span
								className="grid h-7 w-7 shrink-0 place-items-center rounded"
								style={serviceTint(tpl.id)}
							>
								<ServiceIcon id={tpl.id} />
							</span>
							<span className="min-w-0">
								<span className="block truncate text-sm text-gray-200">
									{tpl.name}
								</span>
								<span className="block text-xs text-gray-500">
									{CATEGORY_LABELS[tpl.category] ?? tpl.category}
								</span>
							</span>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}
