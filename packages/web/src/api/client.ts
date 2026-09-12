import type {
	ServiceMeta,
	SetupConfig,
	SetupStatus,
	Stack,
} from "../types/setup";

const BASE_URL = "/api";

const TOKEN_KEY = "stupeflix.token";

/**
 * Thrown on a 401, so the app can ask for the token again instead of rendering
 * the refusal as a failed query. `request()` collapses every other failure to a
 * plain `Error`, and the status code is exactly what that shape loses.
 */
export class Unauthorized extends Error {
	constructor() {
		super("Unauthorized");
		this.name = "Unauthorized";
	}
}

let token = localStorage.getItem(TOKEN_KEY) ?? "";

export function setToken(value: string): void {
	token = value;
	localStorage.setItem(TOKEN_KEY, value);
}

export function clearToken(): void {
	token = "";
	localStorage.removeItem(TOKEN_KEY);
}

export function hasToken(): boolean {
	return token !== "";
}

/** Carried by every call — `uploadTemplate` included, since it skips `request`. */
function authHeaders(): Record<string, string> {
	return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE_URL}${path}`, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...authHeaders(),
			...options?.headers,
		},
	});
	if (res.status === 401) throw new Unauthorized();
	if (!res.ok) {
		const error = await res.json().catch(() => ({}));
		// The API answers `{ error }`; a template's own wording travels in there,
		// and reading only `message` turned every refusal into "Conflict"
		throw new Error(error.error || error.message || res.statusText);
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

/**
 * A need a service declares and nothing satisfies. `reason` is the template's
 * own wording when it has one, and generated when it cannot — a template cannot
 * guess which unsupported peer someone would pick.
 */
export interface UnmetRequirement {
	category: string;
	reason?: string;
}

export interface ServiceInfo {
	name: string;
	label: string;
	enabled: boolean;
	status: string;
	/**
	 * A second axis, not a status: absent for a container that declares no
	 * `healthcheck:`, which is not the same as being unhealthy.
	 */
	health?: "healthy" | "unhealthy" | "starting";
	/**
	 * Blocking needs this service still has, computed on every read so it cannot
	 * go stale. Empty for a service that is not enabled — nothing about it is
	 * broken, it is simply not installed.
	 */
	unmet: UnmetRequirement[];
	/**
	 * A removal keeps the service's own settings on disk, so installing it again
	 * finds a service that is already configured. True when there is something
	 * there, which is the only case where asking what to do with it makes sense.
	 */
	leftovers: boolean;
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

	/** What the run would do, so the summary can draw the grid it will animate. */
	previewSetup: (config: SetupConfig) =>
		request<Pick<SetupStatus, "steps" | "labels">>("/setup/preview", {
			method: "POST",
			body: JSON.stringify(config),
		}),

	getStatus: () => request<SetupStatus>("/setup/status"),

	getAppStatus: () => request<AppStatus>("/status"),

	getServices: () => request<ServiceInfo[]>("/services"),

	getRegistry: () => request<ServiceMeta[]>("/registry"),

	getStacks: () => request<Stack[]>("/stacks"),

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
			// No Content-Type: the browser sets the multipart boundary itself. That
			// is why this one call bypasses `request()`, and why it has to repeat
			// the token header rather than inherit it.
			headers: authHeaders(),
			body: form,
		}).then((res) => {
			if (res.status === 401) throw new Unauthorized();
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

	installService: (
		name: string,
		credentials: Record<string, string>,
		reset = false,
	) =>
		request<{ success: boolean }>(`/install/${name}`, {
			method: "POST",
			body: JSON.stringify({ credentials, reset }),
		}),

	health: () => request<{ status: string }>("/health"),
};
