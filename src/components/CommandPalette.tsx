import { useEffect, useMemo, useState } from "react";
import { useIdeStore } from "../stores/ideStore";
import { flattenFiles, fuzzyScore } from "../utils/tree";
import { fileName } from "../services/fs";
import { lastCodeBlock } from "../utils/extractCode";
import { listAllThemes } from "../theme";

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export default function CommandPalette() {
  const mode = useIdeStore((s) => s.paletteMode);
  const setPaletteMode = useIdeStore((s) => s.setPaletteMode);
  const tree = useIdeStore((s) => s.tree);
  const workspacePath = useIdeStore((s) => s.workspacePath);
  const openFile = useIdeStore((s) => s.openFile);
  const openWorkspace = useIdeStore((s) => s.openWorkspace);
  const saveActiveFile = useIdeStore((s) => s.saveActiveFile);
  const toggleChat = useIdeStore((s) => s.toggleChat);
  const toggleSidebar = useIdeStore((s) => s.toggleSidebar);
  const toggleBottomPanel = useIdeStore((s) => s.toggleBottomPanel);
  const refreshOllama = useIdeStore((s) => s.refreshOllama);
  const setMessages = useIdeStore((s) => s.setMessages);
  const messages = useIdeStore((s) => s.messages);
  const applyToActiveFile = useIdeStore((s) => s.applyToActiveFile);
  const setCreateFileDialog = useIdeStore((s) => s.setCreateFileDialog);
  const setSidebarView = useIdeStore((s) => s.setSidebarView);
  const focusSidebarView = useIdeStore((s) => s.focusSidebarView);
  const reloadActiveFromDisk = useIdeStore((s) => s.reloadActiveFromDisk);
  const newChatSession = useIdeStore((s) => s.newChatSession);
  const setBottomPanelTab = useIdeStore((s) => s.setBottomPanelTab);
  const setBottomPanelOpen = useIdeStore((s) => s.setBottomPanelOpen);
  const workspaceTasks = useIdeStore((s) => s.workspaceTasks);
  const settings = useIdeStore((s) => s.settings);
  const updateSettings = useIdeStore((s) => s.updateSettings);

  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (mode) {
      setQuery("");
      setIndex(0);
    }
  }, [mode]);

  const commands: CommandItem[] = useMemo(
    () => [
      {
        id: "open-folder",
        label: "File: Open Folder…",
        run: () => void openWorkspace(),
      },
      {
        id: "new-file",
        label: "File: New File…",
        run: () =>
          setCreateFileDialog({
            parentDir: workspacePath,
            initialName: "untitled.txt",
            content: "",
          }),
      },
      {
        id: "save",
        label: "File: Save",
        hint: "Ctrl+S",
        run: () => void saveActiveFile(),
      },
      {
        id: "reload",
        label: "File: Revert File",
        run: () => void reloadActiveFromDisk(),
      },
      {
        id: "toggle-chat",
        label: "View: Toggle Chat",
        hint: "Ctrl+L",
        run: toggleChat,
      },
      {
        id: "toggle-sidebar",
        label: "View: Toggle Sidebar",
        hint: "Ctrl+B",
        run: toggleSidebar,
      },
      {
        id: "toggle-terminal",
        label: "View: Toggle Terminal",
        hint: "Ctrl+`",
        run: toggleBottomPanel,
      },
      {
        id: "run-file",
        label: "Run: Run Current File",
        hint: "Ctrl+F5",
        run: () => void useIdeStore.getState().runActiveFile(),
      },
      {
        id: "debug-start",
        label: "Debug: Start",
        hint: "F5",
        run: () => void useIdeStore.getState().startDebugging(),
      },
      {
        id: "debug-stop",
        label: "Debug: Stop",
        run: () => void useIdeStore.getState().stopDebugging(),
      },
      {
        id: "sandbox-run-wasm",
        label: "Sandbox: Run Current Wasm",
        run: () => void useIdeStore.getState().runActiveFileInSandbox(),
      },
      {
        id: "sandbox-cancel",
        label: "Sandbox: Cancel",
        run: () => void useIdeStore.getState().cancelSandbox(),
      },
      {
        id: "run-build",
        label: "Tasks: Run Build Task",
        hint: "Ctrl+Shift+B",
        run: () => void useIdeStore.getState().runDefaultBuildTask(),
      },
      ...workspaceTasks.map((t) => ({
        id: `task-${t.label}`,
        label: `Tasks: Run Task — ${t.label}`,
        run: () => void useIdeStore.getState().runTask(t.label),
      })),
      {
        id: "search-files",
        label: "Search: Find in Files",
        hint: "Ctrl+Shift+F",
        run: () => focusSidebarView("search"),
      },
      {
        id: "git-view",
        label: "Git: Open Source Control",
        run: () => focusSidebarView("git"),
      },
      {
        id: "problems",
        label: "View: Problems",
        run: () => {
          setBottomPanelOpen(true);
          setBottomPanelTab("problems");
        },
      },
      {
        id: "ollama",
        label: "Ollama: Refresh Connection",
        run: () => void refreshOllama(),
      },
      {
        id: "color-theme",
        label: "Preferences: Color Theme",
        hint: "Ctrl+Shift+T",
        run: () => setPaletteMode("colorTheme"),
      },
      {
        id: "toggle-light-dark",
        label: "Preferences: Toggle Light/Dark Theme",
        run: () => {
          const next =
            settings.themeId === "pide-light" ? "pide-dark" : "pide-light";
          updateSettings({ themeId: next });
        },
      },
      {
        id: "settings",
        label: "Preferences: Open Settings",
        run: () => setSidebarView("settings"),
      },
      {
        id: "new-chat",
        label: "Chat: New Session",
        run: newChatSession,
      },
      {
        id: "clear-chat",
        label: "Chat: Clear",
        run: () => setMessages([]),
      },
      {
        id: "apply-last",
        label: "Chat: Apply Last Code Block",
        run: () => {
          const last = [...messages].reverse().find((m) => m.role === "assistant");
          const block = last ? lastCodeBlock(last.content) : null;
          if (block) applyToActiveFile(block.code);
        },
      },
    ],
    [
      applyToActiveFile,
      messages,
      newChatSession,
      openWorkspace,
      refreshOllama,
      reloadActiveFromDisk,
      saveActiveFile,
      focusSidebarView,
      setBottomPanelOpen,
      setBottomPanelTab,
      setCreateFileDialog,
      setMessages,
      setPaletteMode,
      setSidebarView,
      settings.themeId,
      toggleBottomPanel,
      toggleChat,
      toggleSidebar,
      updateSettings,
      workspacePath,
      workspaceTasks,
    ],
  );

  const items = useMemo(() => {
    if (mode === "quickOpen") {
      const files = flattenFiles(tree);
      return files
        .map((f) => ({
          id: f.path,
          label: fileName(f.path),
          hint: workspacePath ? f.path.replace(workspacePath, "").replace(/^[\\/]/, "") : f.path,
          score: fuzzyScore(query, `${fileName(f.path)} ${f.path}`),
          run: () => void openFile(f.path),
        }))
        .filter((x) => x.score >= 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 50);
    }
    if (mode === "colorTheme") {
      return listAllThemes()
        .map((t) => ({
          id: t.id,
          label: t.name,
          hint: t.id === settings.themeId ? "active" : t.id,
          score: fuzzyScore(query, `${t.name} ${t.id}`),
          run: () => updateSettings({ themeId: t.id }),
        }))
        .filter((x) => x.score >= 0)
        .sort((a, b) => b.score - a.score);
    }
    return commands
      .map((c) => ({
        ...c,
        score: fuzzyScore(query, c.label),
      }))
      .filter((c) => c.score >= 0)
      .sort((a, b) => b.score - a.score);
  }, [
    commands,
    mode,
    openFile,
    query,
    settings.themeId,
    tree,
    updateSettings,
    workspacePath,
  ]);

  useEffect(() => {
    setIndex(0);
  }, [query, mode]);

  if (!mode) return null;

  function close() {
    setPaletteMode(null);
  }

  function activate(i: number) {
    const item = items[i];
    if (!item) return;
    close();
    item.run();
  }

  return (
    <div className="fixed inset-0 z-[95] bg-black/50 flex justify-center pt-[12vh]" onClick={close}>
      <div
        className="w-full max-w-xl bg-pide-quick border border-pide-widget-border rounded-lg shadow-2xl overflow-hidden pide-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 pt-2 text-[10px] uppercase tracking-wider text-pide-muted">
          {mode === "quickOpen"
            ? "Quick Open"
            : mode === "colorTheme"
              ? "Select Color Theme"
              : "Command Palette"}
        </div>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(items.length - 1, i + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            }
            if (e.key === "Enter") {
              e.preventDefault();
              activate(index);
            }
          }}
          placeholder={
            mode === "quickOpen"
              ? "Search files by name…"
              : mode === "colorTheme"
                ? "Search themes…"
                : "Type a command…"
          }
          className="w-full bg-pide-input border-b border-pide-input-border px-4 py-3 text-sm text-pide-input-fg focus:outline-none focus:border-pide-focus"
        />
        <ul className="max-h-80 overflow-auto py-1">
          {!items.length && (
            <li className="px-4 py-3 text-sm text-pide-muted">No results</li>
          )}
          {items.map((item, i) => (
            <li key={item.id}>
              <button
                type="button"
                className={`w-full text-left px-4 py-2 text-sm flex items-center gap-3 transition-colors duration-150 ${
                  i === index
                    ? "bg-[var(--pide-quickInputList-focusBackground)] text-pide-fg"
                    : "text-pide-sidebar-fg hover:bg-pide-list-hover"
                }`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => activate(i)}
              >
                <span className="truncate flex-1">{item.label}</span>
                {"hint" in item && item.hint && (
                  <span className="text-xs text-pide-muted truncate max-w-[45%]">
                    {item.hint}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
