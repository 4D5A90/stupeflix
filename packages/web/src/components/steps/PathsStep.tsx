import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { Accordion } from "../ui/Accordion";
import type { SetupConfig, Library } from "../../types/setup";

interface PathsStepProps {
  config: SetupConfig;
  onChange: (config: SetupConfig) => void;
  onNext: () => void;
}

const LIBRARY_TYPES: { value: Library["type"]; label: string }[] = [
  { value: "movies", label: "Movies" },
  { value: "tvshows", label: "TV Shows" },
  { value: "music", label: "Music" },
];

export function PathsStep({ config, onChange, onNext }: PathsStepProps) {
  const [useBasePath, setUseBasePath] = useState(true);
  const [basePath, setBasePath] = useState("");
  const [mountedRoot, setMountedRoot] = useState("");

  const updatePath = (key: keyof SetupConfig["paths"], value: string) => {
    onChange({
      ...config,
      paths: { ...config.paths, [key]: value },
    });
  };

  const updateBasePath = (value: string) => {
    setBasePath(value);
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
    setUseBasePath(checked);
    if (checked && basePath) {
      updateBasePath(basePath);
    }
  };

  // Running in Docker: only the mounted host root is reachable, so start from it
  useEffect(() => {
    let cancelled = false;
    api
      .getRuntime()
      .then((runtime) => {
        if (cancelled || !runtime.root) return;
        setMountedRoot(runtime.root);
        setBasePath((current) => current || runtime.root);
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

  const updateLibrary = (index: number, field: keyof Library, value: string) => {
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Storage Paths</h2>
        <p className="text-gray-400 text-sm">
          Configure the directories where your media stack will store data.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={useBasePath}
            onClick={() => toggleBasePath(!useBasePath)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              useBasePath ? "bg-brand-600" : "bg-gray-700"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                useBasePath ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
          <span className="text-sm text-gray-300">Base Path</span>
        </div>
        <input
          placeholder={mountedRoot || "/path/to/stupeflix"}
          value={basePath}
          onChange={(e) => updateBasePath(e.target.value)}
          disabled={!useBasePath}
          className="block w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:opacity-50"
        />
        {mountedRoot && (
          <p className="text-xs text-gray-500">
            Running in Docker — paths must stay inside {mountedRoot}, the
            directory mounted from the host.
          </p>
        )}
      </div>

      <div className="space-y-4">
        <Input
          label="Config Path"
          placeholder="/path/to/config"
          value={config.paths.config}
          onChange={(e) => updatePath("config", e.target.value)}
          disabled={useBasePath}
        />
        <Input
          label="Media Path"
          placeholder="/path/to/media"
          value={config.paths.media}
          onChange={(e) => updatePath("media", e.target.value)}
          disabled={useBasePath}
        />

        <div className="ml-4 pl-4 border-l-2 border-gray-700">
          <Accordion
            label="Libraries"
            summary={config.libraries.map((l) => l.name).join(", ")}
            small
          >
            <div className="space-y-1.5">
              {config.libraries.map((lib, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    placeholder="Folder name"
                    value={lib.name}
                    onChange={(e) => updateLibrary(i, "name", e.target.value)}
                    className="flex-1 px-2 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-transparent"
                  />
                  <select
                    value={lib.type}
                    onChange={(e) => updateLibrary(i, "type", e.target.value)}
                    className="px-1.5 py-1 text-xs bg-gray-800 border border-gray-700 rounded text-gray-400 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  >
                    {LIBRARY_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeLibrary(i)}
                    disabled={config.libraries.length <= 1}
                    className="p-1 text-gray-600 hover:text-red-400 transition-colors disabled:opacity-30 disabled:hover:text-gray-600"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addLibrary}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-brand-400 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add
              </button>
            </div>
          </Accordion>
        </div>

        <Input
          label="Torrents Path"
          placeholder="/path/to/torrents"
          value={config.paths.torrents}
          onChange={(e) => updatePath("torrents", e.target.value)}
          disabled={useBasePath}
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={!isValid}>
          Next
        </Button>
      </div>
    </div>
  );
}
