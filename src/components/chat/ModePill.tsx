import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const current = MODES.find((m) => m.id === value) ?? MODES[0];
  const Icon = current.icon;

  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setPos(null);
      return;
    }
    const r = btnRef.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - 220)),
      bottom: window.innerHeight - r.top + 8,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onReposition() {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      setPos({
        left: Math.max(8, Math.min(r.left, window.innerWidth - 220)),
        bottom: window.innerHeight - r.top + 8,
      });
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-medium
          bg-[var(--pide-button-secondaryBackground)] text-[var(--pide-button-secondaryForeground)]
          hover:bg-pide-list-hover border border-pide-input-border transition-colors duration-150"
        title="Chat mode"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon size={13} strokeWidth={2} />
        <span>{current.label}</span>
        <span className="opacity-50 text-[10px]">▾</span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed w-52 rounded-xl border border-pide-widget-border
              bg-pide-widget shadow-xl overflow-hidden z-[9999] pide-fade-in"
            style={{ left: pos.left, bottom: pos.bottom }}
          >
            {MODES.map((m) => {
              const MIcon = m.icon;
              const active = m.id === value;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="menuitem"
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
          </div>,
          document.body,
        )}
    </>
  );
}
