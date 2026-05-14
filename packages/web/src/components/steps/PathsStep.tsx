import { useCallback, useEffect, useState } from "react";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import type { SetupConfig } from "../../types/setup";

interface PathsStepProps {
  config: SetupConfig;
  onChange: (config: SetupConfig) => void;
  onNext: () => void;
}

export function PathsStep({ config, onChange, onNext }: PathsStepProps) {
  const [useBasePath, setUseBasePath] = useState(true);
  const [basePath, setBasePath] = useState("");

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

  const isValid =
    config.paths.config && config.paths.media && config.paths.torrents;

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
              useBasePath ? "bg-blue-600" : "bg-gray-700"
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
          placeholder="/path/to/stupeflix"
          value={basePath}
          onChange={(e) => updateBasePath(e.target.value)}
          disabled={!useBasePath}
          className="block w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50"
        />
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
