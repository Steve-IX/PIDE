import { create } from "zustand";
import type {
  AppSettings,
  ChatMessage,
  DiffApplyRequest,
  FileNode,
  OpenTab,
  PaletteMode,
  ProblemItem,
  RevealRequest,
  SidebarView,
  Toast,
  ToastKind,
} from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { languageFromPath } from "../utils/language";
import { loadSettings, saveSettings } from "../utils/settings";
import {
  createDir,
  createFile,
  deletePath,
  fileName,
  joinPath,
  parentPath,
  pickWorkspaceFolder,
  readFile,
  readWorkspaceTree,
  renamePath,
  writeFile,
} from "../services/fs";
import { checkOllamaOnline, fetchModels, warmModel } from "../services/ollama";
import { resolvePerfConfig } from "../services/perfProfiles";
import {
  loadSessions,
  newSession,
  saveSessions,
  titleFromMessages,
  type ChatSession,
} from "../utils/sessions";
import type { FileProposal } from "../utils/proposals";
import { parseFileProposals } from "../utils/proposals";

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function upsertTab(tabs: OpenTab[], tab: OpenTab): OpenTab[] {
  const idx = tabs.findIndex((t) => t.path === tab.path);
  if (idx === -1) return [...tabs, tab];
  const next = tabs.slice();
  next[idx] = tab;
  return next;
}

function remapTabPath(tabs: OpenTab[], from: string, to: string): OpenTab[] {
  return tabs.map((t) => {
    if (t.path === from) {
      return { ...t, path: to, language: languageFromPath(to) };
    }
    if (t.path.startsWith(from + "\\") || t.path.startsWith(from + "/")) {
      const nextPath = to + t.path.slice(from.length);
      return { ...t, path: nextPath, language: languageFromPath(nextPath) };
    }
    return t;
  });
}

interface IdeState {
  workspacePath: string;
  tree: FileNode | null;
  tabs: OpenTab[];
  activePath: string;
  sidebarView: SidebarView;
  sidebarOpen: boolean;
  chatOpen: boolean;
  bottomPanelOpen: boolean;
  bottomPanelTab: "terminal" | "output" | "problems";
  models: string[];
  selectedModel: string;
  ollamaOnline: boolean;
  messages: ChatMessage[];
  chatStreaming: boolean;
  statusError: string;
  monacoEditor: unknown | null;
  toasts: Toast[];
  settings: AppSettings;
  paletteMode: PaletteMode;
  diffRequest: DiffApplyRequest | null;
  outputLines: string[];
  createFileDialog: { parentDir: string; initialName: string; content: string } | null;
  problems: ProblemItem[];
  revealRequest: RevealRequest | null;
  chatSessions: ChatSession[];
  activeSessionId: string;
  fileProposals: FileProposal[];

  setSidebarView: (view: SidebarView) => void;
  focusSidebarView: (view: SidebarView) => void;
  toggleSidebar: () => void;
  toggleChat: () => void;
  toggleBottomPanel: () => void;
  setBottomPanelOpen: (open: boolean) => void;
  setBottomPanelTab: (tab: "terminal" | "output" | "problems") => void;
  setSelectedModel: (model: string) => void;
  setMessages: (messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  setChatStreaming: (v: boolean) => void;
  setMonacoEditor: (editor: unknown | null) => void;
  setStatusError: (msg: string) => void;
  pushToast: (kind: ToastKind, message: string) => void;
  dismissToast: (id: string) => void;
  updateSettings: (partial: Partial<AppSettings>) => void;
  setPaletteMode: (mode: PaletteMode) => void;
  setDiffRequest: (req: DiffApplyRequest | null) => void;
  setCreateFileDialog: (
    dialog: { parentDir: string; initialName: string; content: string } | null,
  ) => void;
  appendOutput: (line: string) => void;
  addProblem: (problem: Omit<ProblemItem, "id">) => void;
  clearProblems: () => void;
  clearReveal: () => void;
  openFileAt: (path: string, line: number, column?: number) => Promise<void>;
  persistChatSessions: () => void;
  loadChatSessionsForWorkspace: (workspacePath: string) => void;
  newChatSession: () => void;
  switchChatSession: (id: string) => void;
  deleteChatSession: (id: string) => void;
  renameChatSession: (id: string, title: string) => void;
  setFileProposals: (proposals: FileProposal[]) => void;
  toggleProposalSelected: (id: string) => void;
  applySelectedProposals: () => Promise<void>;
  reviewProposal: (id: string) => Promise<void>;

  openWorkspace: () => Promise<void>;
  refreshTree: () => Promise<void>;
  openFile: (path: string, opts?: { forceReload?: boolean }) => Promise<void>;
  setActiveTab: (path: string) => void;
  closeTab: (path: string, opts?: { force?: boolean }) => boolean;
  closeOtherTabs: (path: string) => void;
  closeAllTabs: () => void;
  updateActiveContent: (content: string) => void;
  saveActiveFile: () => Promise<void>;
  saveFilePath: (path: string) => Promise<void>;
  applyToActiveFile: (content: string, opts?: { skipDiff?: boolean }) => void;
  requestApplyWithDiff: (content: string, language?: string) => void;
  confirmDiffApply: () => Promise<void>;
  createAndApply: (relativeOrName: string, content: string) => Promise<void>;
  insertAtCursor: (content: string) => void;
  refreshOllama: () => Promise<void>;
  createNewFile: (parentDir: string, name: string, content?: string) => Promise<string | null>;
  createNewFolder: (parentDir: string, name: string) => Promise<void>;
  renameEntry: (path: string, newName: string) => Promise<void>;
  deleteEntry: (path: string) => Promise<void>;
  reloadActiveFromDisk: () => Promise<void>;
  anyDirty: () => boolean;
  resolveWorkspacePath: (relativeOrAbsolute: string) => string;
}

const initialSettings = typeof window !== "undefined" ? loadSettings() : { ...DEFAULT_SETTINGS };

export const useIdeStore = create<IdeState>((set, get) => ({
  workspacePath: "",
  tree: null,
  tabs: [],
  activePath: "",
  sidebarView: "explorer",
  sidebarOpen: true,
  chatOpen: true,
  bottomPanelOpen: initialSettings.bottomPanelOpen,
  bottomPanelTab: "terminal",
  models: [],
  selectedModel: "",
  ollamaOnline: false,
  messages: [],
  chatStreaming: false,
  statusError: "",
  monacoEditor: null,
  toasts: [],
  settings: initialSettings,
  paletteMode: null,
  diffRequest: null,
  outputLines: [],
  createFileDialog: null,
  problems: [],
  revealRequest: null,
  chatSessions: [],
  activeSessionId: "",
  fileProposals: [],

  setSidebarView: (view) =>
    set((s) => ({
      sidebarView: view,
      sidebarOpen: s.sidebarView === view ? !s.sidebarOpen : true,
    })),
  focusSidebarView: (view) => set({ sidebarView: view, sidebarOpen: true }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
  toggleBottomPanel: () =>
    set((s) => {
      const bottomPanelOpen = !s.bottomPanelOpen;
      const settings = { ...s.settings, bottomPanelOpen };
      saveSettings(settings);
      return { bottomPanelOpen, settings };
    }),
  setBottomPanelOpen: (open) =>
    set((s) => {
      const settings = { ...s.settings, bottomPanelOpen: open };
      saveSettings(settings);
      return { bottomPanelOpen: open, settings };
    }),
  setBottomPanelTab: (tab) => set({ bottomPanelTab: tab }),
  setSelectedModel: (model) => {
    set({ selectedModel: model });
    const { settings } = get();
    const perf = resolvePerfConfig(settings.perfProfile, {
      keepAlive: settings.ollamaKeepAlive,
      numGpu: settings.ollamaNumGpu,
    });
    void warmModel(settings.ollamaBaseUrl, model, perf.keepAlive);
  },
  setMessages: (messages) => {
    set((s) => {
      const next = typeof messages === "function" ? messages(s.messages) : messages;
      return { messages: next };
    });
    get().persistChatSessions();
  },
  setChatStreaming: (v) => {
    set({ chatStreaming: v });
    if (!v) get().persistChatSessions();
  },
  setMonacoEditor: (editor) => set({ monacoEditor: editor }),
  setStatusError: (msg) => set({ statusError: msg }),
  pushToast: (kind, message) => {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    window.setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  updateSettings: (partial) => {
    const settings = { ...get().settings, ...partial };
    saveSettings(settings);
    set({ settings });
    // Theme / density changes apply via CSS vars (subscribers handle Monaco/xterm).
    if (
      partial.themeId !== undefined ||
      partial.colorCustomizations !== undefined ||
      partial.uiDensity !== undefined ||
      partial.uiFontSize !== undefined
    ) {
      void import("../theme").then(({ applyPideTheme }) => {
        applyPideTheme(
          settings.themeId,
          settings.colorCustomizations,
          settings.uiDensity,
        );
        document.documentElement.style.setProperty(
          "--pide-ui-font-size",
          `${settings.uiFontSize}px`,
        );
      });
    }
  },
  setPaletteMode: (mode) => set({ paletteMode: mode }),
  setDiffRequest: (req) => set({ diffRequest: req }),
  setCreateFileDialog: (dialog) => set({ createFileDialog: dialog }),
  appendOutput: (line) =>
    set((s) => ({ outputLines: [...s.outputLines.slice(-500), line] })),
  addProblem: (problem) =>
    set((s) => ({
      problems: [
        ...s.problems.slice(-99),
        { ...problem, id: uid() },
      ],
    })),
  clearProblems: () => set({ problems: [] }),
  clearReveal: () => set({ revealRequest: null }),

  resolveWorkspacePath: (relativeOrAbsolute) => {
    const { workspacePath } = get();
    if (!relativeOrAbsolute) return workspacePath;
    if (
      workspacePath &&
      relativeOrAbsolute.toLowerCase().startsWith(workspacePath.toLowerCase())
    ) {
      return relativeOrAbsolute;
    }
    if (/^[a-zA-Z]:[\\/]/.test(relativeOrAbsolute) || relativeOrAbsolute.startsWith("/")) {
      return relativeOrAbsolute;
    }
    return joinPath(workspacePath, relativeOrAbsolute.replace(/^\.[\\/]/, ""));
  },

  openFileAt: async (path, line, column = 1) => {
    const full = get().resolveWorkspacePath(path);
    await get().openFile(full);
    set({ revealRequest: { path: full, line, column } });
  },

  persistChatSessions: () => {
    const { workspacePath, chatSessions, activeSessionId, messages, selectedModel } = get();
    if (!workspacePath || !activeSessionId) return;
    const next = chatSessions.map((s) =>
      s.id === activeSessionId
        ? {
            ...s,
            messages,
            model: selectedModel || s.model,
            title: titleFromMessages(messages) || s.title,
            updatedAt: Date.now(),
          }
        : s,
    );
    set({ chatSessions: next });
    saveSessions(workspacePath, next);
  },

  loadChatSessionsForWorkspace: (workspacePath) => {
    let sessions = loadSessions(workspacePath);
    if (!sessions.length) {
      const s = newSession(get().selectedModel);
      sessions = [s];
      saveSessions(workspacePath, sessions);
    }
    const active = sessions[0];
    set({
      chatSessions: sessions,
      activeSessionId: active.id,
      messages: active.messages,
      selectedModel: active.model || get().selectedModel,
      fileProposals: [],
    });
  },

  newChatSession: () => {
    const s = newSession(get().selectedModel);
    const sessions = [s, ...get().chatSessions];
    set({
      chatSessions: sessions,
      activeSessionId: s.id,
      messages: [],
      fileProposals: [],
    });
    saveSessions(get().workspacePath, sessions);
  },

  switchChatSession: (id) => {
    get().persistChatSessions();
    const session = get().chatSessions.find((s) => s.id === id);
    if (!session) return;
    set({
      activeSessionId: id,
      messages: session.messages,
      selectedModel: session.model || get().selectedModel,
      fileProposals: parseFileProposals(
        [...session.messages].reverse().find((m) => m.role === "assistant")?.content ?? "",
      ),
    });
  },

  deleteChatSession: (id) => {
    let sessions = get().chatSessions.filter((s) => s.id !== id);
    if (!sessions.length) sessions = [newSession(get().selectedModel)];
    const activeId =
      get().activeSessionId === id ? sessions[0].id : get().activeSessionId;
    const active = sessions.find((s) => s.id === activeId) ?? sessions[0];
    set({
      chatSessions: sessions,
      activeSessionId: active.id,
      messages: active.messages,
    });
    saveSessions(get().workspacePath, sessions);
  },

  renameChatSession: (id, title) => {
    const sessions = get().chatSessions.map((s) =>
      s.id === id ? { ...s, title: title.trim() || s.title } : s,
    );
    set({ chatSessions: sessions });
    saveSessions(get().workspacePath, sessions);
  },

  setFileProposals: (proposals) => set({ fileProposals: proposals }),
  toggleProposalSelected: (id) =>
    set((s) => ({
      fileProposals: s.fileProposals.map((p) =>
        p.id === id ? { ...p, selected: !p.selected } : p,
      ),
    })),

  reviewProposal: async (id) => {
    const prop = get().fileProposals.find((p) => p.id === id);
    if (!prop) return;
    const full = get().resolveWorkspacePath(prop.path);
    let original = "";
    let isNewFile = false;
    try {
      original = await readFile(get().workspacePath, full);
    } catch {
      isNewFile = true;
    }
    set({
      diffRequest: {
        path: full,
        original,
        modified: prop.code,
        language: prop.language,
        isNewFile,
      },
    });
  },

  applySelectedProposals: async () => {
    const selected = get().fileProposals.filter((p) => p.selected);
    if (!selected.length) {
      get().pushToast("info", "No proposals selected");
      return;
    }
    for (const prop of selected) {
      const full = get().resolveWorkspacePath(prop.path);
      try {
        await readFile(get().workspacePath, full);
        await writeFile(get().workspacePath, full, prop.code);
        await get().openFile(full, { forceReload: true });
      } catch {
        await get().createAndApply(
          full.startsWith(get().workspacePath)
            ? full.slice(get().workspacePath.length).replace(/^[\\/]/, "")
            : prop.path,
          prop.code,
        );
      }
    }
    get().pushToast("success", `Applied ${selected.length} file(s)`);
    await get().refreshTree();
  },

  anyDirty: () => get().tabs.some((t) => t.dirty),

  openWorkspace: async () => {
    try {
      if (get().anyDirty()) {
        const ok = window.confirm(
          "You have unsaved changes. Discard them and open another folder?",
        );
        if (!ok) return;
      }
      const selected = await pickWorkspaceFolder();
      if (!selected) return;
      const tree = await readWorkspaceTree(selected);
      set({
        workspacePath: selected,
        tree,
        tabs: [],
        activePath: "",
        statusError: "",
        sidebarView: "explorer",
        sidebarOpen: true,
        problems: [],
        fileProposals: [],
      });
      get().loadChatSessionsForWorkspace(selected);
      get().pushToast("success", "Workspace opened");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ statusError: msg });
      get().pushToast("error", msg);
    }
  },

  refreshTree: async () => {
    const { workspacePath } = get();
    if (!workspacePath) return;
    try {
      const tree = await readWorkspaceTree(workspacePath);
      set({ tree, statusError: "" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ statusError: msg });
      get().pushToast("error", msg);
    }
  },

  openFile: async (path, opts) => {
    const existing = get().tabs.find((t) => t.path === path);
    if (existing && !opts?.forceReload) {
      set({ activePath: path, statusError: "" });
      return;
    }
    const { workspacePath } = get();
    if (!workspacePath) return;
    try {
      const content = await readFile(workspacePath, path);
      const tab: OpenTab = {
        path,
        content,
        originalContent: content,
        language: languageFromPath(path),
        dirty: false,
      };
      set((s) => ({
        tabs: upsertTab(s.tabs, tab),
        activePath: path,
        statusError: "",
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ statusError: msg });
      get().pushToast("error", msg);
    }
  },

  setActiveTab: (path) => set({ activePath: path }),

  closeTab: (path, opts) => {
    const { tabs, activePath } = get();
    const tab = tabs.find((t) => t.path === path);
    if (!tab) return true;
    if (tab.dirty && !opts?.force) {
      const ok = window.confirm(`"${fileName(path)}" has unsaved changes. Close anyway?`);
      if (!ok) return false;
    }
    const idx = tabs.findIndex((t) => t.path === path);
    const next = tabs.filter((t) => t.path !== path);
    let nextActive = activePath;
    if (activePath === path) {
      const neighbor = next[idx - 1] ?? next[idx] ?? null;
      nextActive = neighbor?.path ?? "";
    }
    set({ tabs: next, activePath: nextActive });
    return true;
  },

  closeOtherTabs: (path) => {
    const { tabs } = get();
    for (const t of tabs) {
      if (t.path !== path && t.dirty) {
        const ok = window.confirm("Close other tabs and discard unsaved changes?");
        if (!ok) return;
        break;
      }
    }
    set({
      tabs: get().tabs.filter((t) => t.path === path),
      activePath: path,
    });
  },

  closeAllTabs: () => {
    if (get().anyDirty()) {
      const ok = window.confirm("Close all tabs and discard unsaved changes?");
      if (!ok) return;
    }
    set({ tabs: [], activePath: "" });
  },

  updateActiveContent: (content) => {
    const { activePath, tabs } = get();
    if (!activePath) return;
    set({
      tabs: tabs.map((t) =>
        t.path === activePath
          ? { ...t, content, dirty: content !== t.originalContent }
          : t,
      ),
    });
  },

  saveActiveFile: async () => {
    const { activePath } = get();
    if (!activePath) return;
    await get().saveFilePath(activePath);
  },

  saveFilePath: async (path) => {
    const { workspacePath, tabs } = get();
    const tab = tabs.find((t) => t.path === path);
    if (!tab || !workspacePath) return;
    try {
      await writeFile(workspacePath, tab.path, tab.content);
      set({
        tabs: get().tabs.map((t) =>
          t.path === tab.path
            ? { ...t, originalContent: t.content, dirty: false }
            : t,
        ),
        statusError: "",
      });
      get().pushToast("success", `Saved ${fileName(path)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ statusError: msg });
      get().pushToast("error", msg);
    }
  },

  applyToActiveFile: (content, opts) => {
    const { activePath, tabs } = get();
    if (!activePath) {
      const msg = "Open a file before applying code, or use Create file & apply.";
      set({ statusError: msg });
      get().pushToast("error", msg);
      return;
    }
    if (!opts?.skipDiff) {
      const tab = tabs.find((t) => t.path === activePath);
      if (tab && tab.content !== content) {
        set({
          diffRequest: {
            path: activePath,
            original: tab.content,
            modified: content,
            language: tab.language,
            isNewFile: false,
          },
        });
        return;
      }
    }
    set({
      tabs: tabs.map((t) =>
        t.path === activePath
          ? { ...t, content, dirty: content !== t.originalContent }
          : t,
      ),
      statusError: "",
    });
    get().pushToast("success", "Applied to editor");
    if (get().settings.saveAfterApply) {
      void get().saveActiveFile();
    }
  },

  requestApplyWithDiff: (content, language) => {
    const { activePath, tabs, workspacePath } = get();
    if (!activePath) {
      set({
        createFileDialog: {
          parentDir: workspacePath,
          initialName: "untitled.txt",
          content,
        },
      });
      return;
    }
    const tab = tabs.find((t) => t.path === activePath);
    set({
      diffRequest: {
        path: activePath,
        original: tab?.content ?? "",
        modified: content,
        language: language || tab?.language || "plaintext",
        isNewFile: false,
      },
    });
  },

  confirmDiffApply: async () => {
    const req = get().diffRequest;
    if (!req) return;
    const { workspacePath, settings } = get();
    set({ diffRequest: null });

    if (req.isNewFile) {
      if (!workspacePath) {
        get().pushToast("error", "Open a workspace first");
        return;
      }
      try {
        await createFile(workspacePath, req.path, req.modified);
        await get().refreshTree();
        const tab: OpenTab = {
          path: req.path,
          content: req.modified,
          originalContent: settings.saveAfterApply ? req.modified : "",
          language: req.language,
          dirty: !settings.saveAfterApply,
        };
        if (settings.saveAfterApply) {
          // already written
        }
        set((s) => ({
          tabs: upsertTab(s.tabs, {
            ...tab,
            originalContent: req.modified,
            dirty: false,
          }),
          activePath: req.path,
        }));
        get().pushToast("success", `Created ${fileName(req.path)}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        get().pushToast("error", msg);
      }
      return;
    }

    set({
      tabs: get().tabs.map((t) =>
        t.path === req.path
          ? {
              ...t,
              content: req.modified,
              dirty: req.modified !== t.originalContent,
            }
          : t,
      ),
    });
    get().pushToast("success", "Applied to editor");
    if (settings.saveAfterApply) {
      await get().saveFilePath(req.path);
    }
  },

  createAndApply: async (relativeOrName, content) => {
    const { workspacePath, settings } = get();
    if (!workspacePath) {
      get().pushToast("error", "Open a workspace first");
      return;
    }
    const path = relativeOrName.includes("\\") || relativeOrName.includes("/")
      ? relativeOrName.startsWith(workspacePath)
        ? relativeOrName
        : joinPath(workspacePath, relativeOrName)
      : joinPath(workspacePath, relativeOrName);

    try {
      await createFile(workspacePath, path, content);
      await get().refreshTree();
      const tab: OpenTab = {
        path,
        content,
        originalContent: content,
        language: languageFromPath(path),
        dirty: false,
      };
      set((s) => ({
        tabs: upsertTab(s.tabs, tab),
        activePath: path,
        createFileDialog: null,
      }));
      if (!settings.saveAfterApply) {
        // file already saved on create
      }
      get().pushToast("success", `Created ${fileName(path)}`);
    } catch (err) {
      // If exists, overwrite via write + open
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("already exists")) {
        set({
          diffRequest: {
            path,
            original: "",
            modified: content,
            language: languageFromPath(path),
            isNewFile: false,
          },
        });
        try {
          const existing = await readFile(workspacePath, path);
          set({
            diffRequest: {
              path,
              original: existing,
              modified: content,
              language: languageFromPath(path),
              isNewFile: false,
            },
          });
          await get().openFile(path);
        } catch {
          get().pushToast("error", msg);
        }
        return;
      }
      get().pushToast("error", msg);
    }
  },

  insertAtCursor: (content) => {
    const editor = get().monacoEditor as {
      getSelection?: () => unknown;
      executeEdits?: (source: string, edits: unknown[]) => void;
      focus?: () => void;
    } | null;

    if (editor?.executeEdits && editor.getSelection) {
      const selection = editor.getSelection();
      editor.executeEdits("pide-insert", [
        {
          range: selection,
          text: content,
          forceMoveMarkers: true,
        },
      ]);
      editor.focus?.();
      get().pushToast("success", "Inserted at cursor");
      return;
    }

    const { activePath, tabs } = get();
    if (!activePath) {
      const msg = "Open a file before inserting code.";
      set({ statusError: msg });
      get().pushToast("error", msg);
      return;
    }
    set({
      tabs: tabs.map((t) => {
        if (t.path !== activePath) return t;
        const next = `${t.content}${t.content.endsWith("\n") ? "" : "\n"}${content}`;
        return { ...t, content: next, dirty: next !== t.originalContent };
      }),
      statusError: "",
    });
    get().pushToast("success", "Inserted into file");
  },

  refreshOllama: async () => {
    const baseUrl = get().settings.ollamaBaseUrl;
    const online = await checkOllamaOnline(baseUrl);
    if (!online) {
      set({ ollamaOnline: false, models: [] });
      return;
    }
    try {
      const models = await fetchModels(baseUrl);
      const selected = get().selectedModel;
      const nextSelected = models.includes(selected) ? selected : models[0] ?? "";
      set({
        ollamaOnline: true,
        models,
        selectedModel: nextSelected,
      });
      if (nextSelected) {
        const { settings } = get();
        const perf = resolvePerfConfig(settings.perfProfile, {
          keepAlive: settings.ollamaKeepAlive,
          numGpu: settings.ollamaNumGpu,
        });
        void warmModel(baseUrl, nextSelected, perf.keepAlive);
      }
    } catch (err) {
      set({
        ollamaOnline: false,
        models: [],
        statusError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  createNewFile: async (parentDir, name, content = "") => {
    const { workspacePath } = get();
    if (!workspacePath) {
      get().pushToast("error", "Open a workspace first");
      return null;
    }
    const path = joinPath(parentDir || workspacePath, name);
    try {
      await createFile(workspacePath, path, content);
      await get().refreshTree();
      await get().openFile(path, { forceReload: true });
      get().pushToast("success", `Created ${name}`);
      return path;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      get().pushToast("error", msg);
      return null;
    }
  },

  createNewFolder: async (parentDir, name) => {
    const { workspacePath } = get();
    if (!workspacePath) {
      get().pushToast("error", "Open a workspace first");
      return;
    }
    const path = joinPath(parentDir || workspacePath, name);
    try {
      await createDir(workspacePath, path);
      await get().refreshTree();
      get().pushToast("success", `Created folder ${name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      get().pushToast("error", msg);
    }
  },

  renameEntry: async (path, newName) => {
    const { workspacePath, tabs, activePath } = get();
    if (!workspacePath) return;
    const to = joinPath(parentPath(path), newName);
    try {
      await renamePath(workspacePath, path, to);
      const nextTabs = remapTabPath(tabs, path, to);
      set({
        tabs: nextTabs,
        activePath: activePath === path ? to : activePath.startsWith(path) ? to + activePath.slice(path.length) : activePath,
      });
      await get().refreshTree();
      get().pushToast("success", `Renamed to ${newName}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      get().pushToast("error", msg);
    }
  },

  deleteEntry: async (path) => {
    const { workspacePath, tabs } = get();
    if (!workspacePath) return;
    const ok = window.confirm(`Delete "${fileName(path)}"? This cannot be undone.`);
    if (!ok) return;
    try {
      await deletePath(workspacePath, path);
      const remaining = tabs.filter(
        (t) => t.path !== path && !t.path.startsWith(path + "\\") && !t.path.startsWith(path + "/"),
      );
      const activePath = get().activePath;
      const stillActive = remaining.some((t) => t.path === activePath);
      set({
        tabs: remaining,
        activePath: stillActive ? activePath : remaining[0]?.path ?? "",
      });
      await get().refreshTree();
      get().pushToast("success", "Deleted");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      get().pushToast("error", msg);
    }
  },

  reloadActiveFromDisk: async () => {
    const { activePath, tabs } = get();
    if (!activePath) return;
    const tab = tabs.find((t) => t.path === activePath);
    if (tab?.dirty) {
      const ok = window.confirm("Reload and discard unsaved changes?");
      if (!ok) return;
    }
    await get().openFile(activePath, { forceReload: true });
    get().pushToast("info", "Reloaded from disk");
  },
}));
