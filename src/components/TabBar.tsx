import { useIdeStore } from "../stores/ideStore";
import { fileName } from "../services/fs";

export default function TabBar() {
  const tabs = useIdeStore((s) => s.tabs);
  const activePath = useIdeStore((s) => s.activePath);
  const setActiveTab = useIdeStore((s) => s.setActiveTab);
  const closeTab = useIdeStore((s) => s.closeTab);
  const closeOtherTabs = useIdeStore((s) => s.closeOtherTabs);
  const closeAllTabs = useIdeStore((s) => s.closeAllTabs);

  if (!tabs.length) {
    return (
      <div className="h-9 border-b border-pide-sidebar-border bg-[var(--pide-editorGroupHeader-tabsBackground)] flex items-center px-3 text-xs text-pide-muted">
        No open editors
      </div>
    );
  }

  return (
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
                closeTab(tab.path);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              const choice = window.prompt(
                "Tab action: close | others | all",
                "close",
              );
              if (choice === "others") closeOtherTabs(tab.path);
              else if (choice === "all") closeAllTabs();
              else if (choice === "close") closeTab(tab.path);
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
                closeTab(tab.path);
              }}
              aria-label={`Close ${fileName(tab.path)}`}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
