export type TorrentClient = "transmission" | "qbittorrent";
export type MediaServer = "jellyfin" | "plex" | "emby";

export interface FieldRules {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  message?: string;
}

export interface CredentialField {
  key: string;
  type: "text" | "password" | "email";
  label: string;
  default?: string;
  rules?: FieldRules;
}

export interface ServiceMeta {
  id: string;
  name: string;
  description: string;
  category: string;
  defaultEnabled: boolean;
  credentials: CredentialField[];
}

export interface ServiceCategories {
  torrentClient: TorrentClient;
  mediaServer: MediaServer;
  mediamanager: boolean;
}

export function categoriesToServices(
  registry: ServiceMeta[],
  cats: ServiceCategories,
): Record<string, { enabled: boolean }> {
  const result: Record<string, { enabled: boolean }> = {};
  for (const svc of registry) {
    if (svc.category === "torrentClient") {
      result[svc.id] = { enabled: cats.torrentClient === svc.id };
    } else if (svc.category === "mediaServer") {
      result[svc.id] = { enabled: cats.mediaServer === svc.id };
    } else if (svc.category === "mediaManager") {
      result[svc.id] = { enabled: cats.mediamanager };
    }
  }
  return result;
}

export function servicesToCategories(
  services: Record<string, { enabled: boolean }>,
): ServiceCategories {
  return {
    torrentClient: services.qbittorrent?.enabled
      ? "qbittorrent"
      : "transmission",
    mediaServer: services.plex?.enabled
      ? "plex"
      : services.emby?.enabled
        ? "emby"
        : "jellyfin",
    mediamanager: services.mediamanager?.enabled ?? false,
  };
}

export interface SetupConfig {
  paths: {
    config: string;
    media: string;
    torrents: string;
  };
  credentials: Record<string, Record<string, string>>;
  services: Record<string, { enabled: boolean }>;
}

export type StepStatus = "pending" | "in_progress" | "completed" | "failed";

export interface SetupStatus {
  global: StepStatus;
  steps: Record<string, StepStatus>;
  error: string | null;
}

export type StepId = "paths" | "credentials" | "services" | "progress";

export function buildDefaultConfig(registry: ServiceMeta[]): SetupConfig {
  const services: Record<string, { enabled: boolean }> = {};
  const credentials: Record<string, Record<string, string>> = {};
  for (const svc of registry) {
    services[svc.id] = { enabled: svc.defaultEnabled };
    if (svc.credentials.length > 0) {
      credentials[svc.id] = {};
      for (const field of svc.credentials) {
        credentials[svc.id][field.key] = field.default ?? "";
      }
    }
  }
  return { paths: { config: "", media: "", torrents: "" }, credentials, services };
}
