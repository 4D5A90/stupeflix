import type { StepId } from "../types/setup";

interface StepIndicatorProps {
  current: StepId;
}

const STEPS: { id: StepId; label: string }[] = [
  { id: "paths", label: "Paths" },
  { id: "services", label: "Services" },
  { id: "credentials", label: "Credentials" },
  { id: "progress", label: "Setup" },
];

export function StepIndicator({ current }: StepIndicatorProps) {
  const currentIndex = STEPS.findIndex((s) => s.id === current);

  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {STEPS.map((step, index) => {
        const isActive = step.id === current;
        const isCompleted = index < currentIndex;

        return (
          <div key={step.id} className="flex items-center">
            <div
              className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                isActive
                  ? "bg-brand-600 text-white"
                  : isCompleted
                    ? "bg-green-600 text-white"
                    : "bg-gray-700 text-gray-400"
              }`}
            >
              {isCompleted ? "✓" : index + 1}
            </div>
            <span
              className={`ml-2 text-sm ${
                isActive ? "text-white" : "text-gray-500"
              }`}
            >
              {step.label}
            </span>
            {index < STEPS.length - 1 ? (
              <div
                className={`w-8 h-0.5 mx-3 ${
                  isCompleted ? "bg-green-600" : "bg-gray-700"
                }`}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
