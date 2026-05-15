import { useCallback, useEffect } from "react";
import { RadioGroup } from "../ui/RadioGroup";
import { Accordion } from "../ui/Accordion";
import { Button } from "../ui/Button";
import type { SetupConfig, ServiceMeta } from "../../types/setup";
import { isSingleSelect } from "../../types/setup";

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

  const toggleService = (id: string, enabled: boolean) => {
    onChange({
      ...config,
      services: { ...config.services, [id]: { enabled } },
    });
  };

  const selectSingle = (category: string, selectedId: string) => {
    const updated = { ...config.services };
    for (const svc of registry) {
      if (svc.category === category) {
        updated[svc.id] = { enabled: svc.id === selectedId };
      }
    }
    onChange({ ...config, services: updated });
  };

  // Group services by category
  const categories = new Map<string, ServiceMeta[]>();
  for (const svc of registry) {
    const list = categories.get(svc.category) ?? [];
    list.push(svc);
    categories.set(svc.category, list);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Services</h2>
        <p className="text-gray-400 text-sm">
          Choose which services to use in your media stack.
        </p>
      </div>

      <div className="space-y-4">
        {[...categories.entries()].map(([category, services]) => {
          const label = CATEGORY_LABELS[category] ?? category;
          const single = isSingleSelect(category);

          if (single) {
            const selected = services.find((s) => config.services[s.id]?.enabled);
            const selectedName = selected?.name ?? "";
            const options = services.map((s) => ({
              value: s.id,
              label: s.name,
              description: s.description,
            }));

            return (
              <Accordion key={category} label={label} summary={selectedName}>
                <RadioGroup
                  label=""
                  options={options}
                  value={selected?.id ?? ""}
                  onChange={(v) => selectSingle(category, v)}
                />
              </Accordion>
            );
          }

          // Multi-select: toggles
          const enabledNames = services
            .filter((s) => config.services[s.id]?.enabled)
            .map((s) => s.name)
            .join(", ");

          return (
            <Accordion key={category} label={label} summary={enabledNames}>
              <div className="space-y-2">
                {services.map((svc) => {
                  const enabled = config.services[svc.id]?.enabled ?? false;
                  return (
                    <button
                      key={svc.id}
                      type="button"
                      onClick={() => toggleService(svc.id, !enabled)}
                      className={`flex items-center justify-between w-full px-4 py-3 rounded-lg text-left transition-colors ${
                        enabled
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
                          enabled ? "bg-blue-600" : "bg-gray-600"
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            enabled ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </Accordion>
          );
        })}
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
