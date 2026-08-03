import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIdeStore } from "../stores/ideStore";
import { fileName } from "../services/fs";

export default function TabBar() {
  const tabs = useIdeStore((s) => s.tabs);
  const activePath = useIdeStore((s) => s.activePath);
  const setActiveTab = useIdeStore((s) => s.setActiveTab);
  const closeTab = useIdeStore((s) => s.closeTab);
  const closeOtherTabs = useIdeStore((s) => s.closeOtherTabs);
  const closeAllTabs = useIdeStore((s) => s.closeAllTabs);

  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!menu) {
      setPos(null);
      return;
    }
    setPos({
      left: Math.min(menu.x, window.innerWidth - 180),
      top: Math.min(menu.y, window.innerHeight - 140),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  if (!tabs.length) {
    return (
      <div className="h-9 border-b border-pide-sidebar-border bg-[var(--pide-editorGroupHeader-tabsBackground)] flex items-center px-3 text-xs text-pide-muted">
        No open editors
      </div>
    );
  }

  return (
    <>
      <div className="h-9 border-b border-pide-sidebar-border bg-[var(--pide-editorGroupHeader-tabsBackground)] flex items-stretch overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.path === activePath;
          return (
            <div
              key={tab.path}
              className={`group relative flex items-center gap-1 px-3 border-r border-[var(--pide-tab-border)] text-xs cursor-pointer min-w-[120px] max-w-[220px] transition-colors duration-150 ${
                active
                  ? "bg-pide-tab-active text-[var(--pide-tab-activeForeground)]"
                  : "bg-pide-tab text-[var(--pide-tab-inactiveForeground)] hover:text-pide-fg"
              }`}
              onClick={() => setActiveTab(tab.path)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  void closeTab(tab.path);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, path: tab.path });
              }}
              title={tab.path}
            >
              {active && (
                <span className="absolute left-0 right-0 top-0 h-0.5 bg-[var(--pide-tab-activeBorderTop)]" />
              )}
              <span className="truncate flex-1">
                {tab.dirty ? "● " : ""}
                {fileName(tab.path)}
              </span>
              <button
                type="button"
                className="opacity-60 hover:opacity-100 px-1 rounded hover:bg-pide-list-hover"
                onClick={(e) => {
                  e.stopPropagation();
                  void closeTab(tab.path);
                }}
                aria-label={`Close ${fileName(tab.path)}`}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {menu &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="fixed z-[180] min-w-[160px] rounded-lg border border-pide-widget-border bg-pide-widget
              shadow-2xl py-1 text-[13px] pide-fade-in overflow-hidden"
            style={{ left: pos.left, top: pos.top }}
          >
            {(
              [
                { label: "Close", run: () => void closeTab(menu.path) },
                { label: "Close Others", run: () => void closeOtherTabs(menu.path) },
                { label: "Close All", run: () => void closeAllTabs() },
              ] as const
            ).map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className="w-full text-left px-3 py-2 text-pide-fg hover:bg-pide-list-hover transition-colors duration-150"
                onClick={() => {
                  setMenu(null);
                  item.run();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
