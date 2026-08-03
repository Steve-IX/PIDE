import { useEffect } from "react";
import ActivityBar from "./components/ActivityBar";
import ExplorerPane from "./components/ExplorerPane";
import SearchPane from "./components/SearchPane";
import GitPane from "./components/GitPane";
import OllamaStatus from "./components/OllamaStatus";
import SettingsPane from "./components/SettingsPane";
import EditorPane from "./components/EditorPane";
import ChatPane from "./components/ChatPane";
import StatusBar from "./components/StatusBar";
import ToastHost from "./components/ToastHost";
import CommandPalette from "./components/CommandPalette";
import DiffApplyModal from "./components/DiffApplyModal";
import CreateFileDialog from "./components/CreateFileDialog";
import DialogHost from "./components/DialogHost";
import BottomPanel from "./components/BottomPanel";
import PaneResizer from "./components/PaneResizer";
import { useIdeStore } from "./stores/ideStore";
import { useLlamaSidecarWindowLifecycle } from "./hooks/useLlamaSidecarWindowLifecycle";

function Sidebar() {
  const sidebarView = useIdeStore((s) => s.sidebarView);
  if (sidebarView === "search") return <SearchPane />;
  if (sidebarView === "git") return <GitPane />;
  if (sidebarView === "ollama") return <OllamaStatus />;
  if (sidebarView === "settings") return <SettingsPane />;
  return <ExplorerPane />;
}

export default function App() {
  const sidebarOpen = useIdeStore((s) => s.sidebarOpen);
  const chatOpen = useIdeStore((s) => s.chatOpen);
  const toggleChat = useIdeStore((s) => s.toggleChat);
  const toggleSidebar = useIdeStore((s) => s.toggleSidebar);
  const toggleBottomPanel = useIdeStore((s) => s.toggleBottomPanel);
  const saveActiveFile = useIdeStore((s) => s.saveActiveFile);
  const runActiveFile = useIdeStore((s) => s.runActiveFile);
  const startDebugging = useIdeStore((s) => s.startDebugging);
  const refreshOllama = useIdeStore((s) => s.refreshOllama);
  const setPaletteMode = useIdeStore((s) => s.setPaletteMode);
  const focusSidebarView = useIdeStore((s) => s.focusSidebarView);
  const settings = useIdeStore((s) => s.settings);
  const updateSettings = useIdeStore((s) => s.updateSettings);

  useLlamaSidecarWindowLifecycle();

  useEffect(() => {
    void refreshOllama();
    const id = window.setInterval(() => void refreshOllama(), 15000);
    return () => window.clearInterval(id);
  }, [refreshOllama, settings.ollamaBaseUrl]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && e.shiftKey && key === "t") {
        e.preventDefault();
        setPaletteMode("colorTheme");
        return;
      }
      if (mod && e.shiftKey && key === "p") {
        e.preventDefault();
        setPaletteMode("command");
        return;
      }
      if (mod && e.shiftKey && key === "b") {
        e.preventDefault();
        void useIdeStore.getState().runDefaultBuildTask();
        return;
      }
      if (mod && e.shiftKey && key === "f") {
        e.preventDefault();
        focusSidebarView("search");
        return;
      }
      // Ctrl+F5 — Run Current File (no debugger)
      if (mod && !e.shiftKey && e.key === "F5") {
        e.preventDefault();
        void runActiveFile();
        return;
      }
      if (mod && !e.shiftKey && key === "p") {
        e.preventDefault();
        setPaletteMode("quickOpen");
        return;
      }
      if (!mod) {
        if (e.key === "F5") {
          e.preventDefault();
          const st = useIdeStore.getState();
          if (st.debugState === "stopped") void st.debugContinue();
          else void startDebugging();
        }
        return;
      }

      if (key === "s") {
        e.preventDefault();
        void saveActiveFile();
      } else if (key === "l") {
        e.preventDefault();
        toggleChat();
      } else if (key === "b") {
        e.preventDefault();
        toggleSidebar();
      } else if (e.key === "`") {
        e.preventDefault();
        toggleBottomPanel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    saveActiveFile,
    runActiveFile,
    startDebugging,
    setPaletteMode,
    focusSidebarView,
    toggleBottomPanel,
    toggleChat,
    toggleSidebar,
  ]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 flex min-h-0">
        <ActivityBar />
        {sidebarOpen && (
          <>
            <div
              className="shrink-0 border-r border-pide-sidebar-border min-w-0 transition-[width] duration-150 bg-pide-sidebar text-pide-sidebar-fg"
              style={{ width: settings.sidebarWidth }}
            >
              <Sidebar />
            </div>
            <PaneResizer
              onDrag={(delta) => {
                const next = Math.min(480, Math.max(180, settings.sidebarWidth + delta));
                updateSettings({ sidebarWidth: next });
              }}
            />
          </>
        )}
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0">
            <EditorPane />
          </div>
          <BottomPanel />
        </main>
        {chatOpen && (
          <>
            <PaneResizer
              onDrag={(delta) => {
                const next = Math.min(640, Math.max(280, settings.chatWidth - delta));
                updateSettings({ chatWidth: next });
              }}
            />
            <div
              className="shrink-0 min-w-0 transition-[width] duration-150"
              style={{ width: settings.chatWidth }}
            >
              <ChatPane />
            </div>
          </>
        )}
      </div>
      <StatusBar />
      <ToastHost />
      <CommandPalette />
      <DiffApplyModal />
      <CreateFileDialog />
      <DialogHost />
    </div>
  );
}
