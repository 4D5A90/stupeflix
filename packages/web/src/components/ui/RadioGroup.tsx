interface RadioOption {
  value: string;
  label: string;
  description?: string;
}

interface RadioGroupProps {
  label: string;
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
}

export function RadioGroup({ label, options, value, onChange }: RadioGroupProps) {
  return (
    <div className="space-y-2">
      {label ? <span className="text-gray-300 font-medium">{label}</span> : null}
      <div className="grid grid-cols-1 gap-2">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`flex items-center gap-3 px-4 py-3 rounded-md text-left transition-colors ${
                selected
                  ? "bg-brand-600/20 border border-brand-500"
                  : "bg-gray-700 border border-transparent hover:bg-gray-600"
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                  selected ? "border-brand-500" : "border-gray-500"
                }`}
              >
                {selected ? (
                  <div className="w-2 h-2 rounded-full bg-brand-500" />
                ) : null}
              </div>
              <div>
                <span className="text-gray-100">{option.label}</span>
                {option.description ? (
                  <p className="text-gray-400 text-sm">{option.description}</p>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
