import type { SetupConfig, SetupStatus, ServiceMeta } from "../types/setup";

const BASE_URL = "/api";

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
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

export interface ServiceInfo {
  name: string;
  enabled: boolean;
  status: string;
  port: number;
  webUiPath?: string;
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

  getCredentials: () =>
    request<Record<string, Record<string, string>>>("/credentials"),

  getTemplates: () =>
    request<{ id: string; name: string; category: string; file: string }[]>("/templates"),

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

  scanLibrary: (name: string) =>
    request<{ success: boolean }>(`/services/${name}/scan`, {
      method: "POST",
    }),

  installService: (name: string, credentials: Record<string, string>) =>
    request<{ success: boolean }>(`/install/${name}`, {
      method: "POST",
      body: JSON.stringify({ credentials }),
    }),

  health: () => request<{ status: string }>("/health"),
};
