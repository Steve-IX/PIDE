import { useIdeStore } from "../stores/ideStore";

export default function StatusBar() {
  const workspacePath = useIdeStore((s) => s.workspacePath);
  const activePath = useIdeStore((s) => s.activePath);
  const ollamaOnline = useIdeStore((s) => s.ollamaOnline);
  const selectedModel = useIdeStore((s) => s.selectedModel);
  const statusError = useIdeStore((s) => s.statusError);
  const tabs = useIdeStore((s) => s.tabs);
  const toggleBottomPanel = useIdeStore((s) => s.toggleBottomPanel);
  const setPaletteMode = useIdeStore((s) => s.setPaletteMode);

  const active = tabs.find((t) => t.path === activePath);
  const fileLabel = activePath
    ? activePath.split(/[/\\]/).pop()
    : "No file";

  return (
    <footer className="h-6 shrink-0 bg-pide-status text-pide-status-fg text-[11px] flex items-center px-2 gap-3 overflow-hidden border-t border-[var(--pide-statusBar-border,transparent)]">
      <button
        type="button"
        className="hover:bg-[var(--pide-statusBarItem-hoverBackground)] px-1 rounded transition-colors duration-150"
        onClick={toggleBottomPanel}
        title="Toggle Terminal (Ctrl+`)"
      >
        Terminal
      </button>
      <span className="opacity-70">|</span>
      <span className="truncate" title={workspacePath || "No workspace"}>
        {workspacePath ? workspacePath : "No workspace"}
      </span>
      <span className="opacity-70">|</span>
      <span className="truncate">
        {fileLabel}
        {active?.dirty ? " ●" : ""}
        {active ? ` · ${active.language}` : ""}
      </span>
      <span className="ml-auto flex items-center gap-2 shrink-0">
        {statusError && (
          <span className="truncate max-w-[220px] text-pide-git-mod" title={statusError}>
            {statusError}
          </span>
        )}
        <button
          type="button"
          className="hover:bg-[var(--pide-statusBarItem-hoverBackground)] px-1 rounded transition-colors duration-150"
          onClick={() => setPaletteMode("command")}
        >
          Ctrl+Shift+P
        </button>
        <span className="flex items-center gap-1">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              ollamaOnline ? "bg-pide-git-add" : "bg-pide-status-fg opacity-50"
            }`}
          />
          {ollamaOnline ? selectedModel || "Ollama" : "Ollama offline"}
        </span>
      </span>
    </footer>
  );
}
