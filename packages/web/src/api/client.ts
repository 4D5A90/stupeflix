import type { ServiceMeta, SetupConfig, SetupStatus } from "../types/setup";

const BASE_URL = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE_URL}${path}`, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...options?.headers,
		},
	});
	if (!res.ok) {
		const error = await res.json().catch(() => ({ message: res.statusText }));
		throw new Error(error.message || res.statusText);
	}
	return res.json();
}

export interface RuntimeInfo {
	/** Host directory mounted into the container, empty when running on the host */
	root: string;
	serviceHost: string;
}

export interface AppStatus {
	setup_completed: boolean;
	containers: Record<string, string>;
}

/** One configured library, counted from the filesystem rather than a media server. */
export interface LibraryStat {
	name: string;
	type: string;
	/** Series / albums / movie titles — the thing you browse. */
	primary: number;
	/** Episodes / tracks / files — what those contain. */
	secondary: number;
	primaryUnit: string;
	secondaryUnit: string;
}

export interface DiskStat {
	total: number;
	free: number;
	used: number;
}

export interface LibraryStats {
	libraries: LibraryStat[];
	/** Null when the media path is unset or unreadable. */
	disk: DiskStat | null;
}

/** A value the service reports about itself. The URL stays server-side. */
export interface ServiceInfoField {
	name: string;
	label: string;
	/** Seconds between refreshes, as the template declared it. */
	refresh?: number;
}

export interface ServiceAction {
	id: string;
	label: string;
	/** Icon name from the README's list; an unknown one falls back to the default */
	icon?: string;
}

export interface ServiceInfo {
	name: string;
	label: string;
	enabled: boolean;
	status: string;
	/** Absent for a headless service, which then gets no Open link. */
	port?: number;
	webUiPath?: string;
	/** Actions the service's template declares, one button each */
	actions: ServiceAction[];
	/** Readouts to poll and show on the card; empty for most services */
	info: ServiceInfoField[];
	/** Manual steps or quirks the template wants surfaced, shown as a tooltip */
	notes: string[];
}

/** Every service's stored credentials, keyed by service then by field. */
export type Credentials = Record<string, Record<string, string>>;

/** A template on disk, as the catalogue lists it. */
export interface TemplateSummary {
	id: string;
	name: string;
	category: string;
	file: string;
}

export const api = {
	startSetup: (config: SetupConfig) =>
		request<{ success: boolean; message: string }>("/setup/complete", {
			method: "POST",
			body: JSON.stringify(config),
		}),

	getStatus: () => request<SetupStatus>("/setup/status"),

	getAppStatus: () => request<AppStatus>("/status"),

	getServices: () => request<ServiceInfo[]>("/services"),

	getRegistry: () => request<ServiceMeta[]>("/registry"),

	getRuntime: () => request<RuntimeInfo>("/runtime"),

	getCredentials: () => request<Credentials>("/credentials"),

	getTemplates: () => request<TemplateSummary[]>("/templates"),

	reloadTemplates: () =>
		request<{ success: boolean; count: number }>("/templates/reload", {
			method: "POST",
		}),

	uploadTemplate: (file: File) => {
		const form = new FormData();
		form.append("file", file);
		return fetch(`${BASE_URL}/templates/upload`, {
			method: "POST",
			body: form,
		}).then((res) => {
			if (!res.ok) throw new Error("Upload failed");
			return res.json() as Promise<{ success: boolean; count: number }>;
		});
	},

	getLibraryStats: () => request<LibraryStats>("/library/stats"),

	/** Null for a value the service could not report — never an error. */
	getServiceInfo: (name: string) =>
		request<Record<string, string | null>>(`/services/${name}/info`),

	restartService: (name: string) =>
		request<{ success: boolean }>(`/services/${name}/restart`, {
			method: "POST",
		}),

	/** Replays this service's template, dropping the config it declares owning. */
	reconfigureService: (name: string, credentials: Record<string, string>) =>
		request<{ success: boolean }>(`/services/${name}/reconfigure`, {
			method: "POST",
			body: JSON.stringify({ credentials }),
		}),

	/** Removes the container(s); the service's config directory is left on disk. */
	deleteService: (name: string) =>
		request<{ success: boolean }>(`/services/${name}`, { method: "DELETE" }),

	runAction: (name: string, action: string) =>
		request<{ success: boolean }>(`/services/${name}/actions/${action}`, {
			method: "POST",
		}),

	installService: (name: string, credentials: Record<string, string>) =>
		request<{ success: boolean }>(`/install/${name}`, {
			method: "POST",
			body: JSON.stringify({ credentials }),
		}),

	health: () => request<{ status: string }>("/health"),
};
