import { useCallback, useEffect } from "react";
import { RadioGroup } from "../ui/RadioGroup";
import { Accordion } from "../ui/Accordion";
import { Button } from "../ui/Button";
import type { SetupConfig, ServiceMeta } from "../../types/setup";
import {
  servicesToCategories,
  categoriesToServices,
  type TorrentClient,
  type MediaServer,
} from "../../types/setup";

interface ServicesStepProps {
  registry: ServiceMeta[];
  config: SetupConfig;
  onChange: (config: SetupConfig) => void;
  onNext: () => void;
  onBack: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  torrentClient: "Torrent Client",
  mediaServer: "Media Server",
  mediaManager: "Media Manager",
};

export function ServicesStep({
  registry,
  config,
  onChange,
  onNext,
  onBack,
}: ServicesStepProps) {
  const categories = servicesToCategories(config.services);

  const updateCategory = (
    key: keyof typeof categories,
    value: string | boolean,
  ) => {
    const updated = { ...categories, [key]: value };
    onChange({
      ...config,
      services: categoriesToServices(registry, updated),
    });
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter") onNext();
    },
    [onNext],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const torrentOptions = registry
    .filter((s) => s.category === "torrentClient")
    .map((s) => ({ value: s.id, label: s.name, description: s.description }));

  const mediaServerOptions = registry
    .filter((s) => s.category === "mediaServer")
    .map((s) => ({ value: s.id, label: s.name, description: s.description }));

  const mediaManagers = registry.filter((s) => s.category === "mediaManager");

  const selectedTorrentName = registry.find((s) => s.id === categories.torrentClient)?.name ?? "";
  const selectedMediaServerName = registry.find((s) => s.id === categories.mediaServer)?.name ?? "";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Services</h2>
        <p className="text-gray-400 text-sm">
          Choose which services to use in your media stack.
        </p>
      </div>

      <div className="space-y-4">
        <Accordion
          label={CATEGORY_LABELS.torrentClient}
          summary={selectedTorrentName}
        >
          <RadioGroup
            label=""
            options={torrentOptions}
            value={categories.torrentClient}
            onChange={(v) => updateCategory("torrentClient", v as TorrentClient)}
          />
        </Accordion>

        <Accordion
          label={CATEGORY_LABELS.mediaServer}
          summary={selectedMediaServerName}
        >
          <RadioGroup
            label=""
            options={mediaServerOptions}
            value={categories.mediaServer}
            onChange={(v) => updateCategory("mediaServer", v as MediaServer)}
          />
        </Accordion>

        {mediaManagers.map((svc) => (
          <Accordion
            key={svc.id}
            label={CATEGORY_LABELS.mediaManager}
            summary={categories.mediamanager ? svc.name : ""}
          >
            <button
              type="button"
              onClick={() => updateCategory("mediamanager", !categories.mediamanager)}
              className={`flex items-center justify-between w-full px-4 py-3 rounded-lg text-left transition-colors ${
                categories.mediamanager
                  ? "bg-blue-600/20 border border-blue-500"
                  : "bg-gray-700 border border-transparent hover:bg-gray-600"
              }`}
            >
              <div>
                <span className="text-gray-100">{svc.name}</span>
                <p className="text-gray-400 text-sm">{svc.description}</p>
              </div>
              <div
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  categories.mediamanager ? "bg-blue-600" : "bg-gray-600"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    categories.mediamanager ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </div>
            </button>
          </Accordion>
        ))}
      </div>

      <div className="flex justify-between">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onNext}>Next</Button>
      </div>
    </div>
  );
}
