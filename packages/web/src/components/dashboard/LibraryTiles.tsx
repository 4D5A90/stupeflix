import type { DiskStat, LibraryStats } from "../../api/client";

/** Bytes to the shortest honest figure — 2.7 GB reads better than 2 700 000 000. */
function formatBytes(bytes: number): { value: string; unit: string } {
	const tb = bytes / 1e12;
	if (tb >= 1) return { value: tb.toFixed(1), unit: "TB" };
	return {
		value: (bytes / 1e9).toFixed(bytes / 1e9 >= 100 ? 0 : 1),
		unit: "GB",
	};
}

/**
 * One tile per configured library, plus the disk holding them. The count of
 * tiles is whatever the wizard produced, so the grid flows rather than assuming
 * a fixed set — a new library appears here without a line of code.
 */
export function LibraryTiles({ library }: { library?: LibraryStats }) {
	if (!library || (library.libraries.length === 0 && !library.disk))
		return null;

	return (
		<div
			className="grid gap-3"
			style={{ gridTemplateColumns: "repeat(auto-fit, minmax(9.5rem, 1fr))" }}
		>
			{library.libraries.map((lib) => (
				<div
					key={lib.name}
					className="px-4 pt-3.5 pb-3.5 bg-ink-800 border border-white/[0.07] rounded-lg"
				>
					<span className="block text-[10px] font-semibold uppercase tracking-widest text-gray-500">
						{lib.name}
					</span>
					<span className="block mt-2 text-2xl font-bold leading-none tabular-nums text-white">
						{lib.primary}
						<span className="ml-1.5 text-xs font-normal text-gray-500">
							{lib.primaryUnit}
						</span>
					</span>
					{/* Only worth a second line when it says something the first does not */}
					{lib.secondary !== lib.primary ? (
						<span className="block mt-2 text-xs text-gray-500 tabular-nums">
							{lib.secondary} {lib.secondaryUnit}
						</span>
					) : null}
				</div>
			))}
			{library.disk ? <DiskTile disk={library.disk} /> : null}
		</div>
	);
}

function DiskTile({ disk }: { disk: DiskStat }) {
	const used = formatBytes(disk.used);
	const total = formatBytes(disk.total);
	const percent =
		disk.total > 0
			? Math.min(100, Math.round((disk.used / disk.total) * 100))
			: 0;

	return (
		<div className="px-4 pt-3.5 pb-3.5 bg-ink-800 border border-white/[0.07] rounded-lg">
			<span className="block text-[10px] font-semibold uppercase tracking-widest text-gray-500">
				Disk
			</span>
			<span className="block mt-2 text-2xl font-bold leading-none tabular-nums text-white">
				{used.value}
				<span className="ml-1.5 text-xs font-normal text-gray-500">
					{used.unit} / {total.value} {total.unit}
				</span>
			</span>
			<div className="mt-3 h-1 rounded-full bg-white/10 overflow-hidden">
				<div className="h-full bg-brand-500" style={{ width: `${percent}%` }} />
			</div>
		</div>
	);
}
