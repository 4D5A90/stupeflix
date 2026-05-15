import { useCallback, useEffect } from "react";
import { RadioGroup } from "../ui/RadioGroup";
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

  // Group services by category in display order
  const CATEGORY_ORDER = ["torrentClient", "mediaServer", "mediaManager"];
  const categoryMap = new Map<string, ServiceMeta[]>();
  for (const svc of registry) {
    const list = categoryMap.get(svc.category) ?? [];
    list.push(svc);
    categoryMap.set(svc.category, list);
  }
  const categories = [...categoryMap.entries()].sort(
    ([a], [b]) => (CATEGORY_ORDER.indexOf(a) === -1 ? 99 : CATEGORY_ORDER.indexOf(a)) - (CATEGORY_ORDER.indexOf(b) === -1 ? 99 : CATEGORY_ORDER.indexOf(b)),
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-2">Services</h2>
        <p className="text-gray-400 text-sm">
          Choose which services to use in your media stack.
        </p>
      </div>

      <div className="space-y-3">
        {categories.map(([category, services]) => {
          const label = CATEGORY_LABELS[category] ?? category;
          const single = isSingleSelect(category);
          const enabledServices = services.filter((s) => config.services[s.id]?.enabled);
          const hasSelection = enabledServices.length > 0;

          return (
            <CategorySection key={category} label={label} hasSelection={hasSelection}>
              {(open) => {
                if (!open) {
                  return (
                    <div className="flex flex-wrap gap-1.5">
                      {hasSelection ? (
                        enabledServices.map((s) => (
                          <span
                            key={s.id}
                            className="px-2 py-0.5 text-xs bg-blue-600/20 text-blue-300 border border-blue-500/30 rounded"
                          >
                            {s.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-gray-600 italic">None selected</span>
                      )}
                    </div>
                  );
                }

                if (single) {
                  const selected = enabledServices[0];
                  return (
                    <div className="mt-3">
                      <RadioGroup
                        label=""
                        options={services.map((s) => ({
                          value: s.id,
                          label: s.name,
                          description: s.description,
                        }))}
                        value={selected?.id ?? ""}
                        onChange={(v) => selectSingle(category, v)}
                      />
                    </div>
                  );
                }

                return (
                  <div className="mt-3 space-y-2">
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
                              : "bg-gray-700 border border-transparent hover:bg-gray-700/70"
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
                );
              }}
            </CategorySection>
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

import { useState, type ReactNode } from "react";

function CategorySection({
  label,
  hasSelection,
  children,
}: {
  label: string;
  hasSelection: boolean;
  children: (open: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`p-4 rounded-xl border transition-colors ${
        hasSelection
          ? "bg-gray-800/50 border-blue-500/30"
          : "bg-gray-800/30 border-gray-700"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full text-left"
      >
        <span className="flex items-center gap-2">
          <span className="text-gray-200 font-medium">{label}</span>
          {hasSelection ? (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
          ) : null}
        </span>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform shrink-0 ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {!open ? <div className="mt-2">{children(false)}</div> : children(true)}
    </div>
  );
}
