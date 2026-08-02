import { useEffect, useRef, useState } from "react";
import { Bug, Check, Infinity, ListTodo, MessageCircle, Layers } from "lucide-react";
import type { ChatMode } from "../../types";

const MODES: Array<{
  id: ChatMode;
  label: string;
  hint?: string;
  icon: typeof Infinity;
}> = [
  { id: "agent", label: "Agent", hint: "Ctrl+I", icon: Infinity },
  { id: "plan", label: "Plan", icon: ListTodo },
  { id: "debug", label: "Debug", icon: Bug },
  { id: "multitask", label: "Multitask", icon: Layers },
  { id: "ask", label: "Ask", icon: MessageCircle },
];

export default function ModePill({
  value,
  onChange,
}: {
  value: ChatMode;
  onChange: (mode: ChatMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const current = MODES.find((m) => m.id === value) ?? MODES[0];
  const Icon = current.icon;

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-medium
          bg-[var(--pide-button-secondaryBackground)] text-[var(--pide-button-secondaryForeground)]
          hover:bg-pide-list-hover border border-pide-input-border transition-colors duration-150"
        title="Chat mode"
      >
        <Icon size={13} strokeWidth={2} />
        <span>{current.label}</span>
        <span className="opacity-50 text-[10px]">▾</span>
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 mb-2 w-52 rounded-xl border border-pide-widget-border
            bg-pide-widget shadow-xl overflow-hidden z-50 pide-fade-in"
        >
          {MODES.map((m) => {
            const MIcon = m.icon;
            const active = m.id === value;
            return (
              <button
                key={m.id}
                type="button"
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors duration-150 ${
                  active
                    ? "bg-pide-list-active text-pide-fg"
                    : "text-pide-sidebar-fg hover:bg-pide-list-hover"
                }`}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
              >
                <MIcon size={15} className="shrink-0 opacity-80" />
                <span className="flex-1 font-medium">{m.label}</span>
                {m.hint ? (
                  <span className="text-[10px] text-pide-muted">{m.hint}</span>
                ) : null}
                {active ? <Check size={14} className="text-pide-link" /> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
