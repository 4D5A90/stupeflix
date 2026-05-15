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

// Categories where only one service can be selected
const SINGLE_SELECT_CATEGORIES = ["torrentClient"];

export function isSingleSelect(category: string): boolean {
  return SINGLE_SELECT_CATEGORIES.includes(category);
}

export interface Library {
  name: string;
  type: "movies" | "tvshows" | "music";
}

export const DEFAULT_LIBRARIES: Library[] = [
  { name: "Movies", type: "movies" },
  { name: "TvShows", type: "tvshows" },
];

export interface SetupConfig {
  paths: {
    config: string;
    media: string;
    torrents: string;
  };
  libraries: Library[];
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
  return { paths: { config: "", media: "", torrents: "" }, libraries: [...DEFAULT_LIBRARIES], credentials, services };
}
