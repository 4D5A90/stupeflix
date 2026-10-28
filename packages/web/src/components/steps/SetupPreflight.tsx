import { useState } from "react";
import type { ServiceMeta, SetupConfig } from "../../types/setup";
import { Button } from "../ui/Button";
import { LIBRARY_TYPES } from "./PathsStep";

interface SetupPreflightProps {
	registry: ServiceMeta[];
	config: SetupConfig;
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

interface Folder {
	path: string;
	role: string;
}

/**
 * The folders the run creates, relative to the root they share when they share
 * one — said once in the heading rather than repeated on every line. Paths that
 * share none are listed whole, so nothing downstream needs a special case.
 *
 * The libraries hang off `media` because that is where they are: listing
 * `media/` alone leaves the reader to work out where Movies goes.
 */
function toFolders(config: SetupConfig): { root: string; folders: Folder[] } {
	const { config: cfg, media, torrents } = config.paths;
	const root = commonRoot([cfg, media, torrents]);
	const rel = (full: string) => `${root ? full.slice(root.length + 1) : full}/`;
	const typeLabel = (type: string) =>
		LIBRARY_TYPES.find((t) => t.value === type)?.label ?? type;
	return {
		root,
		folders: [
			{ path: rel(cfg), role: "Service settings" },
			...config.libraries.map((lib) => ({
				path: `${rel(media)}${lib.name}/`,
				role: typeLabel(lib.type),
			})),
			{ path: rel(torrents), role: "Downloads" },
		],
	};
}

function Files({ config }: { config: SetupConfig }) {
	const { root, folders } = toFolders(config);
	return (
		<section
			aria-label="Files"
			className="flex flex-col rounded-lg bg-card px-6 pb-2 pt-4"
		>
			<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-3 pt-1">
				<h3 className="text-lg font-bold">Files</h3>
				<span className="text-sm text-muted">
					Folders created on the host
					{root ? (
						<>
							, under{" "}
							<code className="font-mono text-[13px] text-fg">{root}</code>
						</>
					) : null}
				</span>
			</div>
			<div className="flex flex-wrap gap-x-8 gap-y-2 border-t border-line pb-2 pt-3">
				{folders.map((folder) => (
					<span key={folder.path} className="flex items-baseline gap-2">
						<strong className="font-mono text-sm font-medium">
							{folder.path}
						</strong>
						<span className="text-sm text-muted">{folder.role}</span>
					</span>
				))}
			</div>
		</section>
	);
}

interface Account {
	service: string;
	key: string;
	value: string;
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
			secret: password
				? config.credentials[svc.id]?.[password.key] || undefined
				: undefined,
		});
	}
	return accounts;
}

const cell = "border-t border-line py-3.5 font-mono text-sm";

function Credentials({ accounts }: { accounts: Account[] }) {
	const [revealed, setRevealed] = useState(false);
	const anySecret = accounts.some((a) => a.secret);

	return (
		<section
			aria-label="Credentials"
			className="flex flex-col rounded-lg bg-card px-6 pb-2 pt-4"
		>
			<div className="flex items-center justify-between gap-3 pb-3 pt-1">
				<h3 className="text-lg font-bold">Credentials</h3>
				{anySecret ? (
					// One control for the lot: a button per row becomes a column of
					// buttons the moment a stack has five accounts.
					<Button
						variant="outline"
						size="sm"
						aria-pressed={revealed}
						onClick={() => setRevealed((on) => !on)}
					>
						{revealed ? "hide passwords" : "show passwords"}
					</Button>
				) : null}
			</div>
			<div className="overflow-x-auto">
				{/* The columns belong to the list, not to the row: a grid per row makes
				    every row size its own tracks. */}
				<div className="grid min-w-[560px] grid-cols-[160px_minmax(0,1fr)_minmax(0,1fr)]">
					<span className="pb-2 text-[13px] font-bold text-muted">Service</span>
					<span className="pb-2 text-[13px] font-bold text-muted">Login</span>
					<span className="pb-2 text-[13px] font-bold text-muted">Secret</span>
					{accounts.map((account) => (
						<div key={account.service} className="contents">
							<strong className="border-t border-line py-3.5">
								{account.service}
							</strong>
							<span className={`${cell} pr-4`}>
								<span className="text-muted">{account.key}</span>{" "}
								{account.value}
							</span>
							<span className={`${cell} break-all`}>
								{!account.secret
									? null
									: revealed
										? account.secret
										: // One dot per character, in the same mono face:
											// revealing must not reflow the row.
											"•".repeat(account.secret.length)}
							</span>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

/**
 * Everything that stops being true the moment the run starts. It sits under the
 * grid so that when it folds away on Start Setup the grid does not move:
 * information leaves, the matrix stays exactly where it was and lights up.
 */
export function SetupPreflight({ registry, config }: SetupPreflightProps) {
	const accounts = toAccounts(registry, config);

	return (
		<div className="flex flex-col gap-5">
			<Files config={config} />
			{accounts.length > 0 ? <Credentials accounts={accounts} /> : null}
		</div>
	);
}
