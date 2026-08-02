import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search } from "lucide-react";

export default function ModelPicker({
  autoModel,
  onAutoChange,
  selectedModel,
  onSelectModel,
  models,
  routeLabel,
}: {
  autoModel: boolean;
  onAutoChange: (v: boolean) => void;
  selectedModel: string;
  onSelectModel: (m: string) => void;
  models: string[];
  routeLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.toLowerCase().includes(q));
  }, [models, query]);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) {
      setPos(null);
      return;
    }
    const r = btnRef.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - 300)),
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
        left: Math.max(8, Math.min(r.left, window.innerWidth - 300)),
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

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const pillLabel = autoModel ? "Auto" : selectedModel.split(":")[0] || selectedModel || "Model";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-xs font-medium
          bg-[var(--pide-button-secondaryBackground)] text-[var(--pide-button-secondaryForeground)]
          hover:bg-pide-list-hover border border-pide-input-border transition-colors duration-150 max-w-[140px]"
        title={routeLabel || (autoModel ? "Auto routing" : selectedModel)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="truncate">{pillLabel}</span>
        <span className="opacity-50 text-[10px]">▾</span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed w-72 rounded-xl border border-pide-widget-border
              bg-pide-widget shadow-xl overflow-hidden z-[9999] pide-fade-in"
            style={{ left: pos.left, bottom: pos.bottom }}
          >
            <div className="p-2 border-b border-pide-widget-border">
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-pide-input border border-pide-input-border">
                <Search size={13} className="text-pide-muted shrink-0" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search models"
                  className="flex-1 min-w-0 bg-transparent text-xs text-pide-input-fg outline-none"
                />
              </div>
            </div>

            <div className="px-3 py-3 flex items-start gap-3 border-b border-pide-widget-border">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-pide-fg">Auto</div>
                <p className="text-[11px] text-pide-muted leading-snug mt-0.5">
                  Balanced quality and speed, recommended for most tasks
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoModel}
                onClick={() => onAutoChange(!autoModel)}
                className={`relative w-10 h-5 rounded-full shrink-0 transition-colors duration-150 ${
                  autoModel ? "bg-pide-git-add" : "bg-pide-list-hover border border-pide-input-border"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-150 ${
                    autoModel ? "left-5" : "left-0.5"
                  }`}
                />
              </button>
            </div>

            <ul className="max-h-48 overflow-auto py-1">
              {!filtered.length && (
                <li className="px-3 py-2 text-xs text-pide-muted">No models</li>
              )}
              {filtered.map((m) => {
                const active = !autoModel && m === selectedModel;
                return (
                  <li key={m}>
                    <button
                      type="button"
                      role="menuitem"
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors duration-150 ${
                        active
                          ? "bg-pide-list-active text-pide-fg"
                          : "text-pide-sidebar-fg hover:bg-pide-list-hover"
                      }`}
                      onClick={() => {
                        onAutoChange(false);
                        onSelectModel(m);
                        setOpen(false);
                      }}
                    >
                      <span className="truncate flex-1 font-mono">{m}</span>
                      {active ? <Check size={13} className="text-pide-link shrink-0" /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
