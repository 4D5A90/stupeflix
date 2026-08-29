import type { StepStatus } from "../../types/setup";

interface StatusBadgeProps {
  status: StepStatus;
  label: string;
  small?: boolean;
}

const statusStyles: Record<StepStatus, { bg: string; text: string; icon: string }> = {
  pending: { bg: "bg-gray-700", text: "text-gray-400", icon: "○" },
  in_progress: { bg: "bg-blue-900", text: "text-blue-300", icon: "◔" },
  completed: { bg: "bg-green-900", text: "text-green-300", icon: "✓" },
  failed: { bg: "bg-red-900", text: "text-red-300", icon: "✗" },
};

export function StatusBadge({ status, label, small }: StatusBadgeProps) {
  const style = statusStyles[status];

  if (small) {
    return (
      <div className="flex items-center gap-2 py-0.5">
        <span className={`${style.text} text-xs`}>{style.icon}</span>
        <span className={`${style.text} text-sm`}>{label}</span>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-md ${style.bg}`}
    >
      <span className={`${style.text} text-lg`}>{style.icon}</span>
      <span className={style.text}>{label}</span>
    </div>
  );
}
