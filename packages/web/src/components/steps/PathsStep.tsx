import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useState,
} from "react";
import { api } from "../../api/client";
import type { Library, SetupConfig } from "../../types/setup";
import { Button } from "../ui/Button";
import { fieldClass } from "../ui/Input";
import { Switch } from "../ui/Toggle";

/**
 * What the user typed above the three paths. Not part of `SetupConfig` — the
 * API never sees it, only the paths it fills in — but it is input all the same,
 * so the wizard keeps it rather than this step: a step unmounts the moment the
 * user moves on, and its own state goes with it.
 */
export interface BasePath {
	enabled: boolean;
	value: string;
}

export const INITIAL_BASE_PATH: BasePath = { enabled: true, value: "" };

interface PathsStepProps {
	config: SetupConfig;
	onChange: (config: SetupConfig) => void;
	base: BasePath;
	onBaseChange: Dispatch<SetStateAction<BasePath>>;
	onNext: () => void;
	onCancel: () => void;
}

export const LIBRARY_TYPES: { value: Library["type"]; label: string }[] = [
	{ value: "movies", label: "Movies" },
	{ value: "tvshows", label: "TV Shows" },
	{ value: "music", label: "Music" },
];

export function PathsStep({
	config,
	onChange,
	base,
	onBaseChange,
	onNext,
	onCancel,
}: PathsStepProps) {
	const { enabled: useBasePath, value: basePath } = base;
	const [mountedRoot, setMountedRoot] = useState("");

	const updatePath = (key: keyof SetupConfig["paths"], value: string) => {
		onChange({
			...config,
			paths: { ...config.paths, [key]: value },
		});
	};

	const updateBasePath = (value: string) => {
		onBaseChange((current) => ({ ...current, value }));
		const base = value.replace(/\/+$/, "");
		if (base) {
			onChange({
				...config,
				paths: {
					config: `${base}/config`,
					media: `${base}/media`,
					torrents: `${base}/torrents`,
				},
			});
		} else {
			onChange({
				...config,
				paths: { config: "", media: "", torrents: "" },
			});
		}
	};

	const toggleBasePath = (checked: boolean) => {
		onBaseChange((current) => ({ ...current, enabled: checked }));
		if (checked && basePath) {
			updateBasePath(basePath);
		}
	};

	// Running in Docker: only the mounted host root is reachable, so start from it
	// Listing `config` here would re-run this on every keystroke and keep
	// overwriting the paths the user just typed.
	// biome-ignore lint/correctness/useExhaustiveDependencies: mount-only on purpose
	useEffect(() => {
		let cancelled = false;
		api
			.getRuntime()
			.then((runtime) => {
				if (cancelled || !runtime.root) return;
				setMountedRoot(runtime.root);
				onBaseChange((current) =>
					current.value ? current : { ...current, value: runtime.root },
				);
				onChange({
					...config,
					paths: config.paths.config
						? config.paths
						: {
								config: `${runtime.root}/config`,
								media: `${runtime.root}/media`,
								torrents: `${runtime.root}/torrents`,
							},
				});
			})
			.catch(() => {
				/* running on the host — no mounted root to suggest */
			});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const updateLibrary = (
		index: number,
		field: keyof Library,
		value: string,
	) => {
		const libs = [...config.libraries];
		libs[index] = { ...libs[index], [field]: value };
		onChange({ ...config, libraries: libs });
	};

	const addLibrary = () => {
		onChange({
			...config,
			libraries: [...config.libraries, { name: "", type: "movies" }],
		});
	};

	const removeLibrary = (index: number) => {
		onChange({
			...config,
			libraries: config.libraries.filter((_, i) => i !== index),
		});
	};

	const isValid =
		config.paths.config &&
		config.paths.media &&
		config.paths.torrents &&
		config.libraries.length > 0 &&
		config.libraries.every((l) => l.name.trim());

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === "Enter" && isValid) onNext();
		},
		[isValid, onNext],
	);

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleKeyDown]);

	const paths: { key: keyof SetupConfig["paths"]; label: string }[] = [
		{ key: "config", label: "Config Path" },
		{ key: "media", label: "Media Path" },
		{ key: "torrents", label: "Torrents Path" },
	];

	return (
		<>
			<div className="flex flex-col gap-1.5">
				<h2 className="text-[32px] font-bold leading-tight">General</h2>
				<p className="text-muted">
					Storage paths, libraries, and the values every service shares.
				</p>
			</div>

			<section className="rounded-lg bg-card px-6 py-1">
				<div className="flex flex-col gap-2 py-[18px]">
					<div className={row}>
						<span className={`${rowLabel} flex min-h-11 items-center gap-3`}>
							<Switch
								label="Base Path"
								checked={useBasePath}
								onChange={toggleBasePath}
							/>
							Base Path
						</span>
						<input
							aria-label="Base Path"
							placeholder={mountedRoot || "/path/to/stupeflix"}
							value={basePath}
							onChange={(e) => updateBasePath(e.target.value)}
							disabled={!useBasePath}
							className={`${fieldClass({ mono: true })} ${rowField}`}
						/>
					</div>
					{mountedRoot && (
						<p className="text-[13px] leading-[1.45] text-muted md:ml-[184px]">
							Running in Docker — paths must stay inside{" "}
							<code className="font-mono text-xs">{mountedRoot}</code>, the
							directory mounted from the host.
						</p>
					)}
				</div>
				{paths.map((path) => (
					<label
						key={path.key}
						className={`${row} border-t border-line py-3.5`}
					>
						<span className={rowLabel}>{path.label}</span>
						<input
							placeholder={`/path/to/${path.key}`}
							value={config.paths[path.key]}
							onChange={(e) => updatePath(path.key, e.target.value)}
							disabled={useBasePath}
							className={`${fieldClass({ mono: true })} ${rowField}`}
						/>
					</label>
				))}
			</section>

			<section className="flex flex-col gap-2.5 rounded-lg bg-card px-6 py-[18px]">
				<div className="flex flex-col gap-1">
					<h3 className="text-lg font-bold">Libraries</h3>
					<p className="text-sm text-muted">
						One folder per library, created inside{" "}
						{config.paths.media ? (
							<code className="font-mono text-[13px] text-fg">
								{config.paths.media}
							</code>
						) : (
							"the Media Path"
						)}
						.
					</p>
				</div>
				{config.libraries.map((lib, i) => (
					// A library is identified only by its position, so removing a row
					// renumbers every row under it and React reuses the wrong DOM node.
					// Harmless today — both fields are controlled and a row holds no state
					// of its own — but it silently misfires the moment one does.
					// biome-ignore lint/suspicious/noArrayIndexKey: no stable id on a library yet
					<div key={i} className="flex items-center gap-2">
						<input
							aria-label="Folder name"
							placeholder="Folder name"
							value={lib.name}
							onChange={(e) => updateLibrary(i, "name", e.target.value)}
							className={`${fieldClass({ mono: true })} flex-auto`}
						/>
						<select
							aria-label="Library type"
							value={lib.type}
							onChange={(e) => updateLibrary(i, "type", e.target.value)}
							className={`${fieldClass({ select: true })} flex-[0_0_140px]`}
						>
							{LIBRARY_TYPES.map((t) => (
								<option key={t.value} value={t.value}>
									{t.label}
								</option>
							))}
						</select>
						<button
							type="button"
							aria-label={`Remove ${lib.name || "library"}`}
							onClick={() => removeLibrary(i)}
							disabled={config.libraries.length <= 1}
							className="grid h-11 w-11 flex-none place-items-center rounded text-muted transition-colors hover:text-fail disabled:opacity-30 disabled:hover:text-muted"
						>
							<svg
								aria-hidden="true"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth={2.2}
								strokeLinecap="round"
								className="h-[18px] w-[18px]"
							>
								<path d="M6 6l12 12M18 6L6 18" />
							</svg>
						</button>
					</div>
				))}
				<button
					type="button"
					onClick={addLibrary}
					className="self-start py-2.5 text-[15px] font-bold text-link hover:text-link-hover"
				>
					+ Add
				</button>
			</section>

			<section className="rounded-lg bg-card px-6 py-1">
				<label className={`${row} py-[18px]`}>
					<span className={rowLabel}>Admin Email (optional)</span>
					<input
						type="email"
						autoComplete="email"
						placeholder="admin@example.com"
						value={config.email ?? ""}
						onChange={(e) => onChange({ ...config, email: e.target.value })}
						className={`${fieldClass()} ${rowField}`}
					/>
				</label>
			</section>

			<div className="mt-2 flex justify-end gap-2">
				<Button variant="outline" onClick={onCancel}>
					Cancel
				</Button>
				<Button onClick={onNext} disabled={!isValid}>
					Next
				</Button>
			</div>
		</>
	);
}

/** A label column and a field beside it, wrapping to one column on a phone. */
const row = "flex flex-wrap items-center gap-x-6 gap-y-2";
const rowLabel = "flex-[0_0_160px] font-bold";
const rowField = "flex-[1_1_280px]";
