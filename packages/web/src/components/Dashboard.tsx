import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { api } from "../api/client";
import { ServiceIcon } from "./ui/ServiceIcon";
import type { ServiceMeta, CredentialField } from "../types/setup";

interface DashboardProps {
  onReconfigure: () => void;
  onInstall: (serviceId: string, serviceName: string) => void;
}

const SERVICE_LABELS: Record<string, string> = {
  mediamanager: "MediaManager",
  jellyfin: "Jellyfin",
  plex: "Plex",
  emby: "Emby",
  transmission: "Transmission",
  qbittorrent: "qBittorrent",
  joal: "JOAL",
};

const statusStyles: Record<string, { dot: string }> = {
  running: { dot: "bg-green-500" },
  exited: { dot: "bg-red-500" },
  not_found: { dot: "bg-gray-500" },
};

const CATEGORY_LABELS: Record<string, string> = {
  torrentClient: "Torrent",
  mediaServer: "Media",
  mediaManager: "Manager",
  seeder: "Seeder",
};

export function Dashboard({ onReconfigure, onInstall }: DashboardProps) {
  const queryClient = useQueryClient();

  const { data: services, isLoading } = useQuery({
    queryKey: ["services"],
    queryFn: api.getServices,
    refetchInterval: 5000,
  });

  const { data: registry } = useQuery({
    queryKey: ["registry"],
    queryFn: api.getRegistry,
  });

  const { data: templates } = useQuery({
    queryKey: ["templates"],
    queryFn: api.getTemplates,
  });

  const { data: credentials } = useQuery({
    queryKey: ["credentials"],
    queryFn: api.getCredentials,
  });

  const [copied, setCopied] = useState<string | null>(null);

  const copyPassword = (serviceId: string) => {
    const cred = credentials?.[serviceId];
    const pass = cred?.pass ?? cred?.password ?? cred?.token;
    if (!pass) return;
    navigator.clipboard.writeText(pass);
    setCopied(serviceId);
    setTimeout(() => setCopied(null), 2000);
  };

  const SCANNABLE = ["jellyfin", "plex", "emby"];
  const [scanned, setScanned] = useState<string | null>(null);
  const [scanning, setScanning] = useState<string | null>(null);

  const scanLibrary = (name: string) => {
    setScanning(name);
    const minSpin = new Promise((r) => setTimeout(r, 1000));
    Promise.all([api.scanLibrary(name), minSpin]).then(() => {
      setScanning(null);
      setScanned(name);
      setTimeout(() => setScanned(null), 3000);
    }).catch(() => setScanning(null));
  };

  const invalidateTemplates = () => {
    queryClient.invalidateQueries({ queryKey: ["templates"] });
    queryClient.invalidateQueries({ queryKey: ["registry"] });
  };

  const reload = useMutation({
    mutationFn: api.reloadTemplates,
    onSuccess: () => {
      invalidateTemplates();
      setTimeout(() => reload.reset(), 3000);
    },
  });

  const upload = useMutation({
    mutationFn: api.uploadTemplate,
    onSuccess: invalidateTemplates,
  });

  if (isLoading || !services) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  const enabledServices = services.filter((s) => s.enabled);
  const enabledIds = new Set(enabledServices.map((s) => s.name));
  const uninstalled = (registry ?? []).filter((svc) => !enabledIds.has(svc.id));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold mb-2">Services</h2>
          <p className="text-gray-400 text-sm">Your media stack is running.</p>
        </div>
        <button
          type="button"
          onClick={onReconfigure}
          className="px-3 py-1.5 text-sm text-red-400 border border-red-400/30 rounded-lg hover:bg-red-400/10 transition-colors"
        >
          Reconfigure
        </button>
      </div>

      <div className="space-y-2">
        {enabledServices.map((service) => {
          const style = statusStyles[service.status] ?? statusStyles.not_found;
          const label = SERVICE_LABELS[service.name] ?? service.name;
          const url = `http://localhost:${service.port}${service.webUiPath ?? ""}`;

          return (
            <div
              key={service.name}
              className="flex items-center justify-between px-4 py-3 bg-gray-700 rounded-lg"
            >
              <div className="flex items-center gap-3">
                <div className={`w-2.5 h-2.5 rounded-full ${style.dot}`} />
                <span className="text-gray-400">
                  <ServiceIcon id={service.name} />
                </span>
                <span className="text-white font-medium">{label}</span>
              </div>
              <div className="flex items-center gap-1">
                {SCANNABLE.includes(service.name) ? (
                  <button
                    type="button"
                    onClick={() => scanLibrary(service.name)}
                    disabled={scanning === service.name}
                    className="flex items-center gap-1.5 p-2 text-gray-400 hover:text-blue-400 transition-colors disabled:opacity-50"
                    title="Refresh libraries"
                  >
                    {scanned === service.name ? (
                      <>
                        <span className="text-xs text-green-400">Library refreshed</span>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-green-400">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 ${scanning === service.name ? "animate-spin" : ""}`}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M21.015 4.357v4.992" />
                      </svg>
                    )}
                  </button>
                ) : null}
                {(credentials?.[service.name]?.pass ?? credentials?.[service.name]?.token) ? (
                  <button
                    type="button"
                    onClick={() => copyPassword(service.name)}
                    className="p-2 text-gray-400 hover:text-blue-400 transition-colors"
                    title="Copy credentials"
                  >
                    {copied === service.name ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-green-400">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                      </svg>
                    )}
                  </button>
                ) : null}
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 text-gray-400 hover:text-blue-400 transition-colors"
                  title={`Open ${label}`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
                  </svg>
                </a>
              </div>
            </div>
          );
        })}

        {uninstalled.length > 0 && (
          <InstallCard services={uninstalled} onInstall={onInstall} />
        )}
      </div>

      <div className="border-t border-gray-700 pt-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-semibold">Templates</h2>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors cursor-pointer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add
              <input
                type="file"
                accept=".yml,.yaml"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload.mutate(file);
                  e.target.value = "";
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => reload.mutate()}
              disabled={reload.isPending}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className={`w-4 h-4 ${reload.isPending ? "animate-spin" : ""}`}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reload
            </button>
          </div>
        </div>
        {templates ? (
          <div className="flex flex-wrap gap-2">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-700/50 rounded-lg"
              >
                <span className="text-gray-400">
                  <ServiceIcon id={tpl.id} />
                </span>
                <span className="text-gray-200 text-sm">{tpl.name}</span>
                <span className="text-xs text-gray-500">{CATEGORY_LABELS[tpl.category] ?? tpl.category}</span>
              </div>
            ))}
          </div>
        ) : null}
        {reload.isSuccess ? (
          <p className="mt-2 text-xs text-green-400">
            Reloaded {reload.data.count} templates
          </p>
        ) : null}
      </div>
    </div>
  );
}

function InstallCard({
  services,
  onInstall,
}: {
  services: ServiceMeta[];
  onInstall: (serviceId: string, serviceName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ServiceMeta | null>(null);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const selectService = (svc: ServiceMeta) => {
    setSelected(svc);
    setError(null);
    setCreds(Object.fromEntries((svc.credentials ?? []).map((f: CredentialField) => [f.key, f.default ?? ""])));
  };

  const handleInstall = async () => {
    if (!selected) return;
    setError(null);
    try {
      await api.installService(selected.id, creds);
      onInstall(selected.id, selected.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Installation failed");
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center justify-center w-full px-4 py-2.5 bg-transparent border border-dashed border-gray-700 hover:border-gray-500 rounded-lg transition-colors group"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>
    );
  }

  return (
    <div className="px-4 py-3 bg-transparent border border-dashed border-gray-600 rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-gray-400 text-sm font-medium">Add service</span>
        <button
          type="button"
          onClick={() => { setOpen(false); setSelected(null); }}
          className="text-gray-600 hover:text-gray-400 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {services.map((svc) => (
          <button
            key={svc.id}
            type="button"
            onClick={() => selectService(svc)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-sm transition-colors ${
              selected?.id === svc.id
                ? "bg-blue-600/20 border border-blue-500/50 text-blue-300"
                : "bg-gray-700/50 border border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-700"
            }`}
          >
            <ServiceIcon id={svc.id} />
            {svc.name}
          </button>
        ))}
      </div>

      {selected && selected.credentials.length > 0 && (
        <div className="space-y-2 pt-1">
          {selected.credentials.map((field: CredentialField) => (
            <div key={field.key} className="flex items-center gap-2">
              <label className="text-xs text-gray-500 w-20 shrink-0">{field.label}</label>
              <input
                type={field.type === "password" ? "password" : "text"}
                value={creds[field.key] ?? ""}
                onChange={(e) => setCreds((prev) => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.required === false ? "Optional" : ""}
                className="flex-1 px-2 py-1 text-sm bg-gray-800 border border-gray-600 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gray-500"
              />
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      {selected && (
        <button
          type="button"
          onClick={handleInstall}
          className="w-full py-1.5 text-sm text-blue-400 border border-blue-400/30 rounded hover:bg-blue-400/10 transition-colors"
        >
          Install {selected.name}
        </button>
      )}
    </div>
  );
}
