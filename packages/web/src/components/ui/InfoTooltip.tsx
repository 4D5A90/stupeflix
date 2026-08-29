import { useEffect, useId, useRef, useState } from "react";

interface InfoTooltipProps {
  /** One paragraph per note. Rendered as a list when there are several. */
  notes: string[];
  /** Names what the notes are about, for screen readers. */
  label: string;
}

/**
 * Hover shows it, click pins it — a hover-only tooltip is unreachable on touch,
 * and these notes carry setup steps the user has to act on.
 */
export function InfoTooltip({ notes, label }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!pinned) return;

    const onPointerDown = (e: PointerEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) {
        setPinned(false);
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPinned(false);
      setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pinned]);

  if (notes.length === 0) return null;

  return (
    <span className="relative inline-flex" ref={wrapper}>
      <button
        type="button"
        aria-label={`${label} — setup notes`}
        aria-expanded={open}
        aria-describedby={open ? panelId : undefined}
        onClick={() => {
          setPinned(!pinned);
          setOpen(!pinned);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => !pinned && setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => !pinned && setOpen(false)}
        className={`flex items-center justify-center w-4 h-4 rounded-full border text-[10px] font-semibold transition-colors ${
          open
            ? "border-blue-400 text-blue-300"
            : "border-gray-500 text-gray-400 hover:border-blue-400 hover:text-blue-300"
        }`}
      >
        i
      </button>

      {open ? (
        <span
          id={panelId}
          role="tooltip"
          className="absolute left-1/2 top-6 z-20 w-72 -translate-x-1/2 rounded-lg border border-gray-600 bg-gray-900 px-3 py-2 text-left text-xs leading-relaxed text-gray-300 shadow-xl"
        >
          {notes.length === 1 ? (
            <span className="block">{notes[0]}</span>
          ) : (
            <ul className="list-disc space-y-1 pl-4">
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </span>
      ) : null}
    </span>
  );
}
