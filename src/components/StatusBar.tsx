import { useIdeStore } from "../stores/ideStore";

export default function StatusBar() {
  const workspacePath = useIdeStore((s) => s.workspacePath);
  const activePath = useIdeStore((s) => s.activePath);
  const ollamaOnline = useIdeStore((s) => s.ollamaOnline);
  const selectedModel = useIdeStore((s) => s.selectedModel);
  const lastTokensPerSec = useIdeStore((s) => s.lastTokensPerSec);
  const statusError = useIdeStore((s) => s.statusError);
  const tabs = useIdeStore((s) => s.tabs);
  const toggleBottomPanel = useIdeStore((s) => s.toggleBottomPanel);
  const runActiveFile = useIdeStore((s) => s.runActiveFile);
  const startDebugging = useIdeStore((s) => s.startDebugging);
  const setBottomPanelOpen = useIdeStore((s) => s.setBottomPanelOpen);
  const setBottomPanelTab = useIdeStore((s) => s.setBottomPanelTab);
  const setPaletteMode = useIdeStore((s) => s.setPaletteMode);
  const settings = useIdeStore((s) => s.settings);

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
      <button
        type="button"
        className="hover:bg-[var(--pide-statusBarItem-hoverBackground)] px-1 rounded transition-colors duration-150"
        onClick={() => void runActiveFile()}
        title="Run Current File (Ctrl+F5)"
      >
        Run
      </button>
      <button
        type="button"
        className="hover:bg-[var(--pide-statusBarItem-hoverBackground)] px-1 rounded transition-colors duration-150"
        onClick={() => {
          setBottomPanelOpen(true);
          setBottomPanelTab("debug");
          void startDebugging();
        }}
        title="Start Debugging (F5)"
      >
        Debug
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
        {lastTokensPerSec != null && lastTokensPerSec > 0 ? (
          <span
            className="opacity-90 tabular-nums"
            title="Last generation tokens per second"
          >
            {lastTokensPerSec.toFixed(1)} tok/s
          </span>
        ) : null}
        {settings.hyperSpeed ? (
          <span className="opacity-80" title="Hyper-Speed on">
            Hyper
          </span>
        ) : null}
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
          {ollamaOnline ? selectedModel || "LLM" : "LLM offline"}
        </span>
      </span>
    </footer>
  );
}
