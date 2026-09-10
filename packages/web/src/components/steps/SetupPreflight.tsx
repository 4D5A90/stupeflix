import { useState } from "react";
import type { ServiceMeta, SetupConfig } from "../../types/setup";

interface SetupPreflightProps {
	registry: ServiceMeta[];
	config: SetupConfig;
}

/** Heroicons outline, at the size the tree renders. */
function FolderIcon({ small }: { small?: boolean }) {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			className={small ? "w-3 h-3 shrink-0" : "w-3.5 h-3.5 shrink-0"}
		>
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
			/>
		</svg>
	);
}

interface Branch {
	root: string;
	leaves: { name: string; children: string[] }[];
}

/** The longest directory prefix every path shares — "" when they share none. */
function commonRoot(paths: string[]): string {
	const parts = paths.map((p) => p.split("/"));
	const shared: string[] = [];
	for (let i = 0; i < parts[0].length - 1; i++) {
		const segment = parts[0][i];
		if (!parts.every((p) => p[i] === segment)) break;
		shared.push(segment);
	}
	return shared.length > 1 ? shared.join("/") : "";
}

/**
 * One tree when the paths share a root, one per path when they do not — the
 * same shape either way, so nothing downstream needs a special case.
 *
 * The libraries hang off `media` because that is where they are: a flat list of
 * paths leaves the reader to work that out.
 */
function toBranches(config: SetupConfig): Branch[] {
	const entries = [
		["config", config.paths.config],
		["media", config.paths.media],
		["torrents", config.paths.torrents],
	] as const;
	const libraries = config.libraries.map((lib) => lib.name);
	const leafOf = (key: string, full: string) => ({
		name: full.slice(full.lastIndexOf("/") + 1),
		children: key === "media" ? libraries : [],
	});

	const root = commonRoot(entries.map(([, full]) => full));
	if (root) {
		return [{ root, leaves: entries.map(([key, full]) => leafOf(key, full)) }];
	}
	return entries.map(([key, full]) => ({
		root: full.slice(0, full.lastIndexOf("/")) || "/",
		leaves: [leafOf(key, full)],
	}));
}

function FileTree({ config }: { config: SetupConfig }) {
	return (
		<div className="flex flex-wrap gap-x-7 gap-y-2 pl-2.5">
			{toBranches(config).map((branch) => (
				<div key={branch.root} className="flex flex-col gap-1.5 min-w-0">
					<span className="font-mono text-[11.5px] text-gray-500 truncate">
						{branch.root}
					</span>
					<div className="flex flex-wrap gap-x-7 gap-y-1.5">
						{branch.leaves.map((leaf) => (
							<div key={leaf.name} className="flex flex-col gap-1 min-w-0">
								<span className="flex items-center gap-2 text-[13px] text-gray-200">
									<FolderIcon />
									{leaf.name}
								</span>
								{leaf.children.length > 0 ? (
									// Depth by indent and a hairline, not by drawn characters
									<div className="flex flex-col gap-0.5 ml-1.5 pl-4 border-l border-white/[0.12]">
										{leaf.children.map((child) => (
											<span
												key={child}
												className="flex items-center gap-2 text-xs text-brand-300"
											>
												<FolderIcon small />
												{child}
											</span>
										))}
									</div>
								) : null}
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

interface Account {
	service: string;
	key: string;
	value: string;
	hasSecret: boolean;
	secret?: string;
}

/**
 * What the wizard is about to create an account with. The identity is what a
 * summary is for — it is the part that can be wrong — so the secret stays shut
 * until asked for.
 */
function toAccounts(registry: ServiceMeta[], config: SetupConfig): Account[] {
	const accounts: Account[] = [];
	for (const svc of registry) {
		if (!config.services[svc.id]?.enabled) continue;
		const fields = svc.credentials ?? [];
		const identity = fields.find(
			(f) => f.type === "email" || f.type === "text",
		);
		if (!identity) continue;
		const password = fields.find((f) => f.type === "password");
		const value = config.credentials[svc.id]?.[identity.key];
		if (!value) continue;
		accounts.push({
			service: svc.name,
			key: identity.key,
			value,
			hasSecret: Boolean(
				password && config.credentials[svc.id]?.[password.key],
			),
			secret: password ? config.credentials[svc.id]?.[password.key] : undefined,
		});
	}
	return accounts;
}

function Credentials({ accounts }: { accounts: Account[] }) {
	const [revealed, setRevealed] = useState(false);
	const anySecret = accounts.some((a) => a.hasSecret);

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-baseline justify-between gap-4">
				<h3 className="pl-2.5 font-mono text-[10.5px] tracking-[0.14em] uppercase text-gray-400">
					Credentials
				</h3>
				{anySecret ? (
					// One control for the lot: a button per row becomes a column of
					// buttons the moment a stack has five accounts.
					<button
						type="button"
						onClick={() => setRevealed((on) => !on)}
						className="font-mono text-[11px] text-gray-500 hover:text-brand-300 border border-white/[0.07] hover:border-brand-500/40 rounded px-2 py-0.5 transition-colors"
					>
						{revealed ? "hide passwords" : "show passwords"}
					</button>
				) : null}
			</div>

			{/* The columns belong to the list, not to the row: a grid per row makes
			    every row size its own tracks, and `email` pushes its value further
			    right than `user` does. */}
			<dl className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1.4fr)_auto] m-0">
				{accounts.map((account) => (
					<div
						key={account.service}
						className="col-span-full grid grid-cols-subgrid items-baseline gap-3 px-2.5 py-1 rounded-md hover:bg-white/[0.025]"
					>
						<dt className="text-[13px] font-medium text-white truncate">
							{account.service}
						</dt>
						<span className="font-mono text-[11px] text-gray-500">
							{account.key}
						</span>
						<dd className="m-0 font-mono text-xs text-gray-400 truncate">
							{account.value}
						</dd>
						<span className="font-mono text-xs text-right truncate">
							{!account.hasSecret ? null : revealed ? (
								<span className="text-brand-300">{account.secret}</span>
							) : (
								// One dot per character, in the same mono face and with no
								// added tracking: revealing must not resize the column, or
								// every value in the list shifts sideways as it opens.
								<span className="text-gray-600">
									{"\u2022".repeat(account.secret?.length ?? 0)}
								</span>
							)}
						</span>
					</div>
				))}
			</dl>
		</div>
	);
}

/**
 * Everything that stops being true the moment the run starts. It sits under the
 * grid so that when it fades on Start Setup the grid does not move: information
 * leaves, the matrix stays exactly where it was and lights up.
 */
export function SetupPreflight({ registry, config }: SetupPreflightProps) {
	const accounts = toAccounts(registry, config);

	return (
		<div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] gap-x-8 gap-y-4 pt-3.5 border-t border-white/[0.07]">
			<div className="flex flex-col gap-1.5">
				<h3 className="pl-2.5 font-mono text-[10.5px] tracking-[0.14em] uppercase text-gray-400">
					Files
				</h3>
				<FileTree config={config} />
			</div>
			{accounts.length > 0 ? <Credentials accounts={accounts} /> : null}
		</div>
	);
}
