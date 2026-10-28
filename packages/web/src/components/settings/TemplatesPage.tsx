import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useTemplateCatalogue } from "../../hooks/useTemplateCatalogue";
import { categoryLabel } from "../../types/setup";
import { CATEGORY_LABELS } from "../dashboard/categories";
import { buttonClass } from "../ui/Button";
import { ServiceIcon, serviceTint } from "../ui/ServiceIcon";

/**
 * The catalogue behind the services: what the server has loaded, from which
 * file, and the two ways to change it. A template that does not validate is
 * never listed, so the only states are the two `/services` can tell apart.
 */
export function TemplatesPage() {
	const { data: templates } = useQuery({
		queryKey: ["templates"],
		queryFn: api.getTemplates,
	});
	const { data: services } = useQuery({
		queryKey: ["services"],
		queryFn: api.getServices,
	});
	const { reloaded, reload, upload } = useTemplateCatalogue();
	const installed = new Set(
		(services ?? []).filter((s) => s.enabled).map((s) => s.name),
	);

	return (
		<>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 className="text-[32px] font-bold leading-tight">Templates</h2>
				<div className="flex gap-2">
					{/* A label, not a button: it is what opens the file picker, and
					    the input inside it stays the real control. */}
					<label className={`${buttonClass("outline")} cursor-pointer`}>
						{upload.isPending ? "Uploading…" : "Upload .yml"}
						<input
							type="file"
							accept=".yml,.yaml"
							className="sr-only"
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
						className={buttonClass("outline")}
					>
						{reload.isPending
							? "Reloading…"
							: reloaded !== null
								? `Reloaded ${reloaded}`
								: "Reload"}
					</button>
				</div>
			</div>
			<section className="rounded-lg bg-card px-5 py-1">
				<ul>
					{(templates ?? []).map((tpl) => (
						<li
							key={tpl.id}
							className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line py-3 first:border-t-0"
						>
							<span
								className="grid h-9 w-9 flex-none place-items-center rounded"
								style={serviceTint(tpl.id)}
							>
								<ServiceIcon id={tpl.id} />
							</span>
							<strong className="flex-[1_1_140px]">{tpl.name}</strong>
							<span className="flex-[1_1_140px] text-sm text-muted">
								{categoryLabel(tpl.category, CATEGORY_LABELS)}
							</span>
							<span className="flex-[1_1_140px] font-mono text-[13px] text-muted">
								{tpl.file}
							</span>
							<span
								className={`flex-[0_0_96px] text-sm font-bold ${installed.has(tpl.id) ? "text-fg" : "text-muted"}`}
							>
								{installed.has(tpl.id) ? "Installed" : "Available"}
							</span>
						</li>
					))}
				</ul>
			</section>
			<p className="text-sm text-muted">
				Drop a .yml into templates/ and press Reload. A file that does not
				validate is skipped and logged, never loaded half-way.
			</p>
		</>
	);
}
