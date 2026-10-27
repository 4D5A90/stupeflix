import type { DiskStat, LibraryStats } from "../../api/client";

/** Bytes to the shortest honest figure — 2.7 GB reads better than 2 700 000 000. */
function formatBytes(bytes: number): string {
	const tb = bytes / 1e12;
	if (tb >= 1) return `${tb.toFixed(1)} TB`;
	return `${(bytes / 1e9).toFixed(bytes / 1e9 >= 100 ? 0 : 1)} GB`;
}

const count = (n: number) => n.toLocaleString("en-US");

const card = "glass-card flex flex-col rounded-lg px-[18px] py-4";
const head = "flex items-baseline justify-between gap-3";

/**
 * One card per configured library, plus the disk holding them. The count of
 * cards is whatever the wizard produced, so the column flows rather than
 * assuming a fixed set — a new library appears here without a line of code.
 * The disk is shown here and nowhere else.
 */
export function LibraryTiles({ library }: { library?: LibraryStats }) {
	if (!library || (library.libraries.length === 0 && !library.disk))
		return null;

	return (
		<aside
			aria-label="Libraries"
			className="flex flex-[1_1_260px] flex-col gap-2"
		>
			<h2 className="mb-2 text-2xl font-bold">Libraries</h2>
			{library.libraries.map((lib) => (
				<div key={lib.name} className={`${card} gap-1`}>
					<span className={head}>
						<span className="font-bold">{lib.name}</span>
						<span className="text-sm text-muted">
							<strong className="text-[22px] text-fg tabular-nums">
								{count(lib.primary)}
							</strong>{" "}
							{lib.primaryUnit}
						</span>
					</span>
					{/* Only worth a line when it says something the first does not */}
					{lib.secondary !== lib.primary ? (
						<span className="self-end text-[13px] text-muted tabular-nums">
							{count(lib.secondary)} {lib.secondaryUnit}
						</span>
					) : null}
				</div>
			))}
			{library.disk ? <DiskCard disk={library.disk} /> : null}
		</aside>
	);
}

function DiskCard({ disk }: { disk: DiskStat }) {
	const percent =
		disk.total > 0
			? Math.min(100, Math.round((disk.used / disk.total) * 100))
			: 0;

	return (
		<div className={`${card} gap-2.5`}>
			<span className={head}>
				<span className="font-bold">Disk</span>
				<span className="text-sm text-muted">
					<strong className="text-[22px] text-fg tabular-nums">
						{formatBytes(disk.used)}
					</strong>{" "}
					of {formatBytes(disk.total)}
				</span>
			</span>
			<span className="h-1 bg-track">
				<span
					className="block h-1 bg-accent"
					style={{ width: `${percent}%` }}
				/>
			</span>
		</div>
	);
}
