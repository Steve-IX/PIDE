import type { ReactNode } from "react";
import { Files, Search, GitBranch, Bot, Settings } from "lucide-react";
import { useIdeStore } from "../stores/ideStore";
import type { SidebarView } from "../types";

const items: Array<{ view: SidebarView; label: string; icon: ReactNode }> = [
  { view: "explorer", label: "Explorer", icon: <Files size={20} /> },
  { view: "search", label: "Search", icon: <Search size={20} /> },
  { view: "git", label: "Source Control", icon: <GitBranch size={20} /> },
  { view: "ollama", label: "Models", icon: <Bot size={20} /> },
  { view: "settings", label: "Settings", icon: <Settings size={20} /> },
];

export default function ActivityBar() {
  const sidebarView = useIdeStore((s) => s.sidebarView);
  const sidebarOpen = useIdeStore((s) => s.sidebarOpen);
  const setSidebarView = useIdeStore((s) => s.setSidebarView);
  const ollamaOnline = useIdeStore((s) => s.ollamaOnline);

  return (
    <aside className="w-12 shrink-0 bg-pide-activity border-r border-[var(--pide-activityBar-border)] flex flex-col items-center py-2 gap-1">
      {items.map((item) => {
        const active = sidebarOpen && sidebarView === item.view;
        return (
          <button
            key={item.view}
            title={item.label}
            aria-label={item.label}
            onClick={() => setSidebarView(item.view)}
            className={`relative w-10 h-10 rounded-md flex items-center justify-center transition-colors duration-150 ${
              active
                ? "bg-pide-list-active text-pide-activity-fg"
                : "text-[var(--pide-activityBar-inactiveForeground)] hover:text-pide-activity-fg hover:bg-pide-list-hover"
            }`}
          >
            {active && (
              <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-[var(--pide-activityBar-activeBorder)]" />
            )}
            {item.icon}
            {item.view === "ollama" && (
              <span
                className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${
                  ollamaOnline ? "bg-pide-git-add" : "bg-[var(--pide-activityBar-inactiveForeground)]"
                }`}
              />
            )}
          </button>
        );
      })}
    </aside>
  );
}
