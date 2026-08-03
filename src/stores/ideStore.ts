import { create } from "zustand";
import type {
  AppSettings,
  ChatMessage,
  ConfirmDialogState,
  DiffApplyRequest,
  FileNode,
  OpenTab,
  PaletteMode,
  ProblemItem,
  PromptDialogState,
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
import { warmModel } from "../services/ollama";
import {
  checkInferenceOnline,
  fetchInferenceModels,
} from "../services/llmChat";
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
import type { PideTask } from "../services/tasks";
import type { PideLaunchConfig } from "../services/launch";
import {
  COMPILER_PROBLEM_SOURCES,
  DiagnosticLineBuffer,
} from "../services/diagnosticParsers";

export type DebugState = "idle" | "starting" | "running" | "stopped";

export interface DebugStackFrame {
  id: number;
  name: string;
  sourcePath?: string;
  line?: number;
  column?: number;
}

export interface DebugVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
}

export interface PtySessionMeta {
  id: string;
  title: string;
}

const MAX_PTY_SESSIONS = 4;
const diagBuffer = new DiagnosticLineBuffer();
let diagIdleTimer: number | null = null;
let dapUnlisten: (() => void) | null = null;
let dapInitializedWaiter: (() => void) | null = null;
let dapInitializedFlag = false;

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

type GetSet = {
  get: () => IdeState;
  set: (
    partial:
      | Partial<IdeState>
      | ((s: IdeState) => Partial<IdeState>),
  ) => void;
};

async function refreshStackAndVars(
  get: () => IdeState,
  set: GetSet["set"],
  threadId: number,
) {
  const dap = await import("../services/dap");
  const stackRes = await dap.dapStackTrace(threadId);
  const body = stackRes.body as {
    stackFrames?: Array<{
      id: number;
      name: string;
      line?: number;
      column?: number;
      source?: { path?: string };
    }>;
  };
  const frames: DebugStackFrame[] = (body?.stackFrames ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    sourcePath: f.source?.path,
    line: f.line,
    column: f.column,
  }));
  set({ debugStackFrames: frames });
  const top = frames[0];
  if (top) {
    if (top.sourcePath && top.line) {
      set({
        debugStoppedPath: top.sourcePath,
        debugStoppedLine: top.line,
      });
      void get().openFileAt(top.sourcePath, top.line, top.column ?? 1);
    }
    await get().selectDebugFrame(top.id);
  }
}

async function handleDapMessage(
  get: () => IdeState,
  set: GetSet["set"],
  payload: { kind: string; body: Record<string, unknown> },
) {
  const body = payload.body;
  if (payload.kind === "event") {
    const event = String(body.event ?? "");
    if (event === "initialized") {
      dapInitializedFlag = true;
      dapInitializedWaiter?.();
      return;
    }
    if (event === "stopped") {
      const evBody = (body.body ?? {}) as { threadId?: number; reason?: string };
      const threadId = evBody.threadId ?? 1;
      set({
        debugState: "stopped",
        debugThreadId: threadId,
        debugStopReason: evBody.reason ?? "stopped",
      });
      try {
        await refreshStackAndVars(get, set, threadId);
      } catch {
        /* adapter may not be ready */
      }
      return;
    }
    if (event === "continued") {
      set({
        debugState: "running",
        debugStoppedPath: null,
        debugStoppedLine: null,
      });
      return;
    }
    if (event === "output") {
      const evBody = (body.body ?? {}) as { output?: string; category?: string };
      if (!evBody.output) return;
      const line = evBody.output.replace(/\r?\n$/, "");
      const cat = evBody.category ?? "console";
      // Program stdout/console → Debug tab; adapter stderr noise → Output
      if (cat === "stderr" || cat === "telemetry") {
        get().appendOutput(line);
      } else {
        get().appendDebugConsole(line);
      }
      return;
    }
    if (event === "terminated" || event === "exited" || event === "pideTerminated") {
      set({
        debugState: "idle",
        debugThreadId: null,
        debugStackFrames: [],
        debugVariables: [],
        debugStoppedPath: null,
        debugStoppedLine: null,
      });
      return;
    }
  }
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
  bottomPanelTab: "terminal" | "output" | "problems" | "debug";
  /** Live interactive PTY session id (null if terminal not mounted). */
  activePtyId: string | null;
  /** Command to inject once the PTY is ready. */
  pendingPtyWrite: string | null;
  /** Metadata for multi-session terminals. */
  ptySessions: PtySessionMeta[];
  /** BottomPanel should create a session with this title. */
  pendingPtySessionTitle: string | null;
  workspaceTasks: PideTask[];
  workspaceLaunchConfigs: PideLaunchConfig[];
  diagnosticsCapture: boolean;
  /** path -> breakpoint lines */
  breakpoints: Record<string, number[]>;
  debugState: DebugState;
  debugThreadId: number | null;
  debugStackFrames: DebugStackFrame[];
  debugVariables: DebugVariable[];
  debugStopReason: string;
  debugStoppedPath: string | null;
  debugStoppedLine: number | null;
  models: string[];
  selectedModel: string;
  ollamaOnline: boolean;
  messages: ChatMessage[];
  chatStreaming: boolean;
  /** Last completed generation tok/s (for status bar). */
  lastTokensPerSec: number | null;
  statusError: string;
  monacoEditor: unknown | null;
  toasts: Toast[];
  settings: AppSettings;
  paletteMode: PaletteMode;
  diffRequest: DiffApplyRequest | null;
  outputLines: string[];
  /** Program / DAP console stdout shown in the Debug tab. */
  debugConsoleLines: string[];
  createFileDialog: { parentDir: string; initialName: string; content: string } | null;
  confirmDialog: ConfirmDialogState | null;
  promptDialog: PromptDialogState | null;
  problems: ProblemItem[];
  revealRequest: RevealRequest | null;
  chatSessions: ChatSession[];
  activeSessionId: string;
  fileProposals: FileProposal[];

  requestConfirm: (opts: Omit<ConfirmDialogState, "resolve">) => Promise<boolean>;
  requestPrompt: (opts: Omit<PromptDialogState, "resolve">) => Promise<string | null>;
  setSidebarView: (view: SidebarView) => void;
  focusSidebarView: (view: SidebarView) => void;
  toggleSidebar: () => void;
  toggleChat: () => void;
  toggleBottomPanel: () => void;
  setBottomPanelOpen: (open: boolean) => void;
  setBottomPanelTab: (tab: "terminal" | "output" | "problems" | "debug") => void;
  setActivePtyId: (id: string | null) => void;
  /** Queue or send text to the live PTY (opens terminal). */
  writeToPty: (data: string) => Promise<void>;
  /** Save + Run Current File via language runner into the PTY. */
  runActiveFile: () => Promise<void>;
  /** Run active .wasm via Wasmtime WASI sandbox. */
  runActiveFileInSandbox: () => Promise<void>;
  cancelSandbox: () => Promise<void>;
  /** One-shot host command under Job Object / wall limits. */
  runLimitedCommand: (opts: {
    program: string;
    args?: string[];
    cwd?: string;
  }) => Promise<void>;
  registerPtySession: (id: string, title: string) => void;
  unregisterPtySession: (id: string) => void;
  focusPtySession: (id: string) => void;
  requestPtySession: (title: string) => void;
  clearPendingPtySession: () => void;
  refreshWorkspaceTasks: () => Promise<void>;
  refreshWorkspaceLaunchConfigs: () => Promise<void>;
  runTask: (label: string) => Promise<void>;
  runDefaultBuildTask: () => Promise<void>;
  beginDiagnosticsCapture: () => void;
  appendPtyOutputForDiagnostics: (chunk: string) => void;
  clearProblemsBySources: (sources: string[]) => void;
  toggleBreakpoint: (path: string, line: number) => void;
  setBreakpointsForPath: (path: string, lines: number[]) => void;
  startDebugging: (configName?: string) => Promise<void>;
  stopDebugging: () => Promise<void>;
  debugContinue: () => Promise<void>;
  debugStepOver: () => Promise<void>;
  debugStepIn: () => Promise<void>;
  debugStepOut: () => Promise<void>;
  selectDebugFrame: (frameId: number) => Promise<void>;
  setSelectedModel: (model: string) => void;
  setMessages: (messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  setChatStreaming: (v: boolean) => void;
  setLastTokensPerSec: (v: number | null) => void;
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
  appendDebugConsole: (line: string) => void;
  clearDebugConsole: () => void;
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
  closeTab: (path: string, opts?: { force?: boolean }) => Promise<boolean>;
  closeOtherTabs: (path: string) => Promise<void>;
  closeAllTabs: () => Promise<void>;
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
  activePtyId: null,
  pendingPtyWrite: null,
  ptySessions: [],
  pendingPtySessionTitle: null,
  workspaceTasks: [],
  workspaceLaunchConfigs: [],
  diagnosticsCapture: false,
  breakpoints: {},
  debugState: "idle",
  debugThreadId: null,
  debugStackFrames: [],
  debugVariables: [],
  debugStopReason: "",
  debugStoppedPath: null,
  debugStoppedLine: null,
  models: [],
  selectedModel: "",
  ollamaOnline: false,
  messages: [],
  chatStreaming: false,
  lastTokensPerSec: null,
  statusError: "",
  monacoEditor: null,
  toasts: [],
  settings: initialSettings,
  paletteMode: null,
  diffRequest: null,
  outputLines: [],
  debugConsoleLines: [],
  createFileDialog: null,
  confirmDialog: null,
  promptDialog: null,
  problems: [],
  revealRequest: null,
  chatSessions: [],
  activeSessionId: "",
  fileProposals: [],

  requestConfirm: (opts) =>
    new Promise((resolve) => {
      set({
        confirmDialog: {
          ...opts,
          resolve: (ok) => {
            set({ confirmDialog: null });
            resolve(ok);
          },
        },
      });
    }),

  requestPrompt: (opts) =>
    new Promise((resolve) => {
      set({
        promptDialog: {
          ...opts,
          resolve: (value) => {
            set({ promptDialog: null });
            resolve(value);
          },
        },
      });
    }),

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
  setActivePtyId: (id) => set({ activePtyId: id }),
  registerPtySession: (id, title) =>
    set((s) => {
      if (s.ptySessions.some((p) => p.id === id)) {
        return {
          ptySessions: s.ptySessions.map((p) => (p.id === id ? { id, title } : p)),
          activePtyId: id,
        };
      }
      return {
        ptySessions: [...s.ptySessions, { id, title }].slice(-MAX_PTY_SESSIONS),
        activePtyId: id,
      };
    }),
  unregisterPtySession: (id) =>
    set((s) => {
      const ptySessions = s.ptySessions.filter((p) => p.id !== id);
      const activePtyId =
        s.activePtyId === id ? (ptySessions[ptySessions.length - 1]?.id ?? null) : s.activePtyId;
      return { ptySessions, activePtyId };
    }),
  focusPtySession: (id) => set({ activePtyId: id }),
  requestPtySession: (title) => {
    get().setBottomPanelOpen(true);
    get().setBottomPanelTab("terminal");
    const existing = get().ptySessions.find((p) => p.title === title);
    if (existing) {
      set({ activePtyId: existing.id, pendingPtySessionTitle: null });
      return;
    }
    if (get().ptySessions.length >= MAX_PTY_SESSIONS) {
      get().pushToast("error", `Max ${MAX_PTY_SESSIONS} terminal sessions`);
      return;
    }
    set({ pendingPtySessionTitle: title });
  },
  clearPendingPtySession: () => set({ pendingPtySessionTitle: null }),
  clearProblemsBySources: (sources) => {
    const setSources = new Set(sources);
    set((s) => ({
      problems: s.problems.filter((p) => !setSources.has(p.source)),
    }));
  },
  beginDiagnosticsCapture: () => {
    diagBuffer.reset();
    get().clearProblemsBySources([...COMPILER_PROBLEM_SOURCES]);
    set({ diagnosticsCapture: true });
    if (diagIdleTimer != null) window.clearTimeout(diagIdleTimer);
    diagIdleTimer = window.setTimeout(() => {
      set({ diagnosticsCapture: false });
      diagIdleTimer = null;
    }, 120_000);
  },
  appendPtyOutputForDiagnostics: (chunk) => {
    if (!get().diagnosticsCapture) return;
    const { workspacePath, addProblem } = get();
    const drafts = diagBuffer.feed(chunk, workspacePath);
    for (const d of drafts) addProblem(d);
    if (diagIdleTimer != null) window.clearTimeout(diagIdleTimer);
    diagIdleTimer = window.setTimeout(() => {
      set({ diagnosticsCapture: false });
      diagIdleTimer = null;
    }, 2000);
  },
  refreshWorkspaceTasks: async () => {
    const { workspacePath } = get();
    if (!workspacePath) {
      set({ workspaceTasks: [] });
      return;
    }
    const { loadWorkspaceTasks } = await import("../services/tasks");
    const workspaceTasks = await loadWorkspaceTasks(workspacePath);
    set({ workspaceTasks });
  },
  refreshWorkspaceLaunchConfigs: async () => {
    const { workspacePath } = get();
    if (!workspacePath) {
      set({ workspaceLaunchConfigs: [] });
      return;
    }
    const { loadWorkspaceLaunchConfigs } = await import("../services/launch");
    const workspaceLaunchConfigs = await loadWorkspaceLaunchConfigs(workspacePath);
    set({ workspaceLaunchConfigs });
  },
  toggleBreakpoint: (path, line) => {
    set((s) => {
      const cur = new Set(s.breakpoints[path] ?? []);
      if (cur.has(line)) cur.delete(line);
      else cur.add(line);
      const lines = [...cur].sort((a, b) => a - b);
      const breakpoints = { ...s.breakpoints };
      if (lines.length) breakpoints[path] = lines;
      else delete breakpoints[path];
      return { breakpoints };
    });
    const { debugState, breakpoints } = get();
    if (debugState !== "idle") {
      void import("../services/dap").then((dap) =>
        dap.dapSetBreakpoints(path, breakpoints[path] ?? []).catch(() => undefined),
      );
    }
  },
  setBreakpointsForPath: (path, lines) => {
    set((s) => {
      const breakpoints = { ...s.breakpoints };
      const uniq = [...new Set(lines)].sort((a, b) => a - b);
      if (uniq.length) breakpoints[path] = uniq;
      else delete breakpoints[path];
      return { breakpoints };
    });
  },
  startDebugging: async (configName) => {
    const {
      workspaceLaunchConfigs,
      refreshWorkspaceLaunchConfigs,
      workspacePath,
      pushToast,
      setBottomPanelOpen,
      setBottomPanelTab,
      activePath,
    } = get();
    if (!workspacePath) {
      pushToast("error", "Open a workspace first");
      return;
    }
    if (!workspaceLaunchConfigs.length) await refreshWorkspaceLaunchConfigs();
    const configs = get().workspaceLaunchConfigs;
    const { pickDefaultLaunchConfig, resolveLaunchAdapter } = await import(
      "../services/launch"
    );
    const config = configName
      ? configs.find((c) => c.name === configName)
      : pickDefaultLaunchConfig(configs, activePath || null);
    if (!config) {
      pushToast(
        "error",
        "No launch.json configs. Add .vscode/launch.json (type: python + debugpy).",
      );
      return;
    }

    let resolved;
    try {
      resolved = resolveLaunchAdapter(config, workspacePath, activePath || null);
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
      return;
    }

    // Persist buffer so debugpy hits the same lines as the editor.
    try {
      await get().saveActiveFile();
    } catch {
      /* non-fatal */
    }

    // Fresh breakpoint map after any path remaps / saves
    const bpMap = get().breakpoints;

    const dap = await import("../services/dap");
    if (await dap.dapIsActive()) {
      await dap.dapStop();
    }

    set({
      debugState: "starting",
      debugStackFrames: [],
      debugVariables: [],
      debugStopReason: "",
      debugThreadId: null,
      debugStoppedPath: null,
      debugStoppedLine: null,
      debugConsoleLines: [],
    });
    setBottomPanelOpen(true);
    setBottomPanelTab("debug");
    dapInitializedFlag = false;
    dapInitializedWaiter = null;

    if (dapUnlisten) {
      dapUnlisten();
      dapUnlisten = null;
    }
    dapUnlisten = await dap.listenDapMessages((payload) => {
      void handleDapMessage(get, set, payload);
    });

    const programPath =
      typeof resolved.requestArgs.program === "string"
        ? resolved.requestArgs.program
        : activePath || null;

    // Prefer absolute program path with normalized separators for debugpy.
    if (typeof resolved.requestArgs.program === "string") {
      resolved.requestArgs.program = dap.normalizeDapPath(resolved.requestArgs.program);
    }

    try {
      try {
        await dap.dapStart({
          adapterCommand: resolved.adapterCommand,
          adapterArgs: resolved.adapterArgs,
          cwd: resolved.cwd,
        });
      } catch (err) {
        if (resolved.adapterCommand === "python") {
          await dap.dapStart({
            adapterCommand: "py",
            adapterArgs: ["-3", "-u", "-m", "debugpy.adapter"],
            cwd: resolved.cwd,
          });
        } else {
          throw err;
        }
      }

      const isDebugpy =
        config.type === "python" ||
        config.type === "debugpy" ||
        resolved.adapterArgs.some((a) => String(a).includes("debugpy"));

      const waitInitialized = (ms: number) =>
        new Promise<void>((resolve, reject) => {
          if (dapInitializedFlag) {
            resolve();
            return;
          }
          const t = window.setTimeout(
            () =>
              reject(
                new Error(
                  isDebugpy
                    ? "DAP initialized event timeout (debugpy). Check Output for adapter errors."
                    : "DAP initialized event timeout",
                ),
              ),
            ms,
          );
          dapInitializedWaiter = () => {
            window.clearTimeout(t);
            dapInitializedWaiter = null;
            resolve();
          };
          // Event may have raced in
          if (dapInitializedFlag) {
            window.clearTimeout(t);
            dapInitializedWaiter = null;
            resolve();
          }
        });

      const applyBps = async () => {
        const result = await dap.dapApplyBreakpoints(bpMap, programPath);
        for (const d of result.details) get().appendOutput(`DAP BP: ${d}`);
        if (result.total > 0 && result.verified === 0) {
          pushToast(
            "error",
            "Breakpoints not verified by debugpy — check Output (path mismatch?).",
          );
        } else if (result.verified > 0) {
          get().appendOutput(
            `DAP: ${result.verified}/${result.total} breakpoint(s) verified`,
          );
        }
      };

      get().appendOutput(`DAP: starting ${config.name} (${resolved.adapterCommand})`);
      await dap.dapInitialize();
      get().appendOutput("DAP: initialize response OK");

      if (isDebugpy) {
        // debugpy / VS Code order: launch → initialized → setBreakpoints → configurationDone
        // (launch response is deferred until configurationDone)
        const launchPromise =
          resolved.request === "attach"
            ? dap.dapAttach(resolved.requestArgs)
            : dap.dapLaunch(resolved.requestArgs);
        await waitInitialized(30000);
        get().appendOutput("DAP: initialized (after launch)");
        await applyBps();
        await dap.dapConfigurationDone();
        const launchOrAttach = await launchPromise;
        if (launchOrAttach.success === false) {
          const message =
            typeof launchOrAttach.message === "string"
              ? launchOrAttach.message
              : `DAP ${resolved.request} failed`;
          throw new Error(message);
        }
      } else {
        await waitInitialized(15000);
        get().appendOutput("DAP: initialized");
        await applyBps();
        await dap.dapConfigurationDone();
        const launchOrAttach =
          resolved.request === "attach"
            ? await dap.dapAttach(resolved.requestArgs)
            : await dap.dapLaunch(resolved.requestArgs);
        if (launchOrAttach.success === false) {
          const message =
            typeof launchOrAttach.message === "string"
              ? launchOrAttach.message
              : `DAP ${resolved.request} failed`;
          throw new Error(message);
        }
      }

      // Don't clobber an early breakpoint stop that raced in during launch.
      set((s) => ({
        debugState: s.debugState === "stopped" ? "stopped" : "running",
      }));
      pushToast("info", `Debugging: ${config.name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const hint =
        (resolved.adapterCommand === "python" || resolved.adapterCommand === "py") &&
        /not found|Failed to start|No module/i.test(msg)
          ? " Install debugpy: pip install debugpy"
          : "";
      pushToast("error", `${msg}${hint ? `.${hint}` : ""}`.replace(/\.\./g, "."));
      set({ debugState: "idle" });
      try {
        await dap.dapStop();
      } catch {
        /* ignore */
      }
    }
  },
  stopDebugging: async () => {
    const dap = await import("../services/dap");
    try {
      await dap.dapStop();
    } catch {
      /* ignore */
    }
    if (dapUnlisten) {
      dapUnlisten();
      dapUnlisten = null;
    }
    set({
      debugState: "idle",
      debugThreadId: null,
      debugStackFrames: [],
      debugVariables: [],
      debugStopReason: "",
      debugStoppedPath: null,
      debugStoppedLine: null,
    });
  },
  debugContinue: async () => {
    const { debugThreadId } = get();
    if (debugThreadId == null) return;
    const dap = await import("../services/dap");
    await dap.dapContinue(debugThreadId);
    set({
      debugState: "running",
      debugStoppedPath: null,
      debugStoppedLine: null,
    });
  },
  debugStepOver: async () => {
    const { debugThreadId } = get();
    if (debugThreadId == null) return;
    const dap = await import("../services/dap");
    await dap.dapNext(debugThreadId);
  },
  debugStepIn: async () => {
    const { debugThreadId } = get();
    if (debugThreadId == null) return;
    const dap = await import("../services/dap");
    await dap.dapStepIn(debugThreadId);
  },
  debugStepOut: async () => {
    const { debugThreadId } = get();
    if (debugThreadId == null) return;
    const dap = await import("../services/dap");
    await dap.dapStepOut(debugThreadId);
  },
  selectDebugFrame: async (frameId) => {
    const dap = await import("../services/dap");
    const frame = get().debugStackFrames.find((f) => f.id === frameId);
    if (frame?.sourcePath && frame.line) {
      set({
        debugStoppedPath: frame.sourcePath,
        debugStoppedLine: frame.line,
      });
      void get().openFileAt(frame.sourcePath, frame.line, frame.column ?? 1);
    }
    const scopesRes = await dap.dapScopes(frameId);
    const body = scopesRes.body as { scopes?: Array<{ variablesReference: number }> } | undefined;
    const scopes = body?.scopes ?? [];
    const vars: DebugVariable[] = [];
    for (const scope of scopes.slice(0, 3)) {
      if (!scope.variablesReference) continue;
      const vRes = await dap.dapVariables(scope.variablesReference);
      const vBody = vRes.body as {
        variables?: Array<{
          name: string;
          value: string;
          type?: string;
          variablesReference: number;
        }>;
      };
      for (const v of vBody?.variables ?? []) {
        vars.push({
          name: v.name,
          value: v.value,
          type: v.type,
          variablesReference: v.variablesReference,
        });
      }
    }
    set({ debugVariables: vars.slice(0, 80) });
  },
  runTask: async (label) => {
    const { workspaceTasks, workspacePath, writeToPty, pushToast, appendOutput, requestPtySession } =
      get();
    const task = workspaceTasks.find((t) => t.label === label);
    if (!task) {
      pushToast("error", `Unknown task: ${label}`);
      return;
    }
    const { resolveTaskCommand } = await import("../services/tasks");
    const command = resolveTaskCommand(task, workspacePath);
    get().beginDiagnosticsCapture();
    appendOutput(`Task (${label}): ${command}`);
    requestPtySession(`Task: ${label}`);
    // Allow BottomPanel to create session, then write.
    window.setTimeout(() => {
      void writeToPty(`${command}\r`);
    }, 500);
    pushToast("info", `Running task: ${label}`);
  },
  runDefaultBuildTask: async () => {
    const { workspaceTasks, refreshWorkspaceTasks, pushToast } = get();
    if (!workspaceTasks.length) await refreshWorkspaceTasks();
    const tasks = get().workspaceTasks;
    const { pickDefaultBuildTask } = await import("../services/tasks");
    const task = pickDefaultBuildTask(tasks);
    if (!task) {
      pushToast("error", "No tasks found (.vscode/tasks.json or .pide/tasks.json)");
      return;
    }
    await get().runTask(task.label);
  },
  writeToPty: async (data) => {
    const { activePtyId } = get();
    get().setBottomPanelOpen(true);
    get().setBottomPanelTab("terminal");
    if (activePtyId) {
      const { ptyWrite } = await import("../services/pty");
      await ptyWrite(activePtyId, data);
      return;
    }
    set({ pendingPtyWrite: data });
  },
  runActiveFile: async () => {
    const { tabs, activePath, saveActiveFile, writeToPty, pushToast, appendOutput } = get();
    const tab = tabs.find((t) => t.path === activePath);
    if (!tab) {
      pushToast("error", "No active file to run");
      return;
    }
    await saveActiveFile();
    const { buildRunCommand } = await import("../services/runners");
    const hint = buildRunCommand({ path: tab.path, language: tab.language });
    if (!hint) {
      pushToast("error", `No runner for ${tab.language || "this file type"}`);
      return;
    }
    get().beginDiagnosticsCapture();
    appendOutput(`Run (${hint.label}): ${hint.command}`);
    await writeToPty(`${hint.command}\r`);
    pushToast("info", `Running with ${hint.label}…`);
  },
  runActiveFileInSandbox: async () => {
    const {
      workspacePath,
      activePath,
      settings,
      pushToast,
      appendOutput,
      setBottomPanelOpen,
      setBottomPanelTab,
    } = get();
    if (!workspacePath) {
      pushToast("error", "Open a workspace first");
      return;
    }
    if (!activePath || !/\.wasm$/i.test(activePath)) {
      pushToast(
        "error",
        "Sandbox runs .wasm (WASI) files; use Ctrl+F5 for host Run.",
      );
      return;
    }
    const sandbox = await import("../services/sandbox");
    setBottomPanelOpen(true);
    setBottomPanelTab("output");
    appendOutput(`Sandbox (wasm): ${activePath}`);
    const unlisten = await sandbox.listenSandboxChunks((chunk) => {
      appendOutput(chunk.data.replace(/\r?\n$/, ""));
    });
    try {
      const result = await sandbox.sandboxRunWasm({
        workspacePath,
        wasmPath: activePath,
        wallSeconds: settings.sandboxWallSeconds,
        wasmMemoryMib: settings.sandboxWasmMemoryMib,
      });
      // Chunks already streamed to Output; note exit status only.
      appendOutput(
        `— sandbox exit ${result.code} (${result.reason}${result.timedOut ? ", timed out" : ""})`,
      );
      if (result.timedOut || (result.reason !== "ok" && result.reason !== "exit")) {
        pushToast(
          "error",
          `Sandbox: ${result.reason}${result.code != null ? ` (code ${result.code})` : ""}`,
        );
      } else {
        pushToast("info", `Sandbox finished (code ${result.code})`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushToast("error", msg);
      appendOutput(msg);
    } finally {
      unlisten();
    }
  },
  cancelSandbox: async () => {
    const sandbox = await import("../services/sandbox");
    try {
      await sandbox.sandboxCancel();
      get().pushToast("info", "Sandbox cancel requested");
    } catch (err) {
      get().pushToast("error", err instanceof Error ? err.message : String(err));
    }
  },
  runLimitedCommand: async (opts) => {
    const {
      workspacePath,
      settings,
      pushToast,
      appendOutput,
      setBottomPanelOpen,
      setBottomPanelTab,
    } = get();
    if (!workspacePath) {
      pushToast("error", "Open a workspace first");
      return;
    }
    const sandbox = await import("../services/sandbox");
    setBottomPanelOpen(true);
    setBottomPanelTab("output");
    appendOutput(
      `Sandbox (limited): ${opts.program} ${(opts.args ?? []).join(" ")}`.trim(),
    );
    const unlisten = await sandbox.listenSandboxChunks((chunk) => {
      appendOutput(chunk.data.replace(/\r?\n$/, ""));
    });
    try {
      const result = await sandbox.sandboxRunLimited({
        workspacePath,
        program: opts.program,
        args: opts.args,
        cwd: opts.cwd,
        wallSeconds: settings.sandboxWallSeconds,
        hostMemoryMib: settings.sandboxHostMemoryMib,
      });
      appendOutput(
        `— limited exit ${result.code} (${result.reason}${result.timedOut ? ", timed out" : ""})`,
      );
      if (result.timedOut) {
        pushToast("error", `Limited run timed out (${result.reason})`);
      } else if (result.code !== 0) {
        pushToast("error", `Limited run exited ${result.code}: ${result.reason}`);
      } else {
        pushToast("info", "Limited run finished");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushToast("error", msg);
      appendOutput(msg);
    } finally {
      unlisten();
    }
  },
  setSelectedModel: (model) => {
    set({ selectedModel: model });
    const { settings } = get();
    if (settings.inferenceBackend === "llamaCpp") return;
    const perf = resolvePerfConfig(settings.perfProfile, {
      keepAlive: settings.ollamaKeepAlive,
      numGpu: settings.ollamaNumGpu,
      hyperSpeed: settings.hyperSpeed,
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
  setLastTokensPerSec: (v) => set({ lastTokensPerSec: v }),
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
  appendDebugConsole: (line) =>
    set((s) => ({
      debugConsoleLines: [...s.debugConsoleLines.slice(-500), line],
    })),
  clearDebugConsole: () => set({ debugConsoleLines: [] }),
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
        const ok = await get().requestConfirm({
          title: "Unsaved changes",
          message: "You have unsaved changes. Discard them and open another folder?",
          confirmLabel: "Discard & open",
          danger: true,
        });
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
      void get().refreshWorkspaceTasks();
      try {
        const { ensureDefaultLaunchJson } = await import("../services/launch");
        const created = await ensureDefaultLaunchJson(selected);
        if (created) {
          get().pushToast("info", "Updated .vscode/launch.json (multi-language debug)");
          await get().refreshTree();
        }
      } catch {
        /* non-fatal */
      }
      void get().refreshWorkspaceLaunchConfigs();
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
      // Binary WASM: track path for sandbox without loading bytes into the editor.
      if (/\.wasm$/i.test(path)) {
        const placeholder =
          "; binary WASM module — use Command Palette: Sandbox: Run Current Wasm\n";
        const tab: OpenTab = {
          path,
          content: placeholder,
          originalContent: placeholder,
          language: "plaintext",
          dirty: false,
        };
        set((s) => ({
          tabs: upsertTab(s.tabs, tab),
          activePath: path,
          statusError: "",
        }));
        return;
      }
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

  closeTab: async (path, opts) => {
    const { tabs, activePath } = get();
    const tab = tabs.find((t) => t.path === path);
    if (!tab) return true;
    if (tab.dirty && !opts?.force) {
      const ok = await get().requestConfirm({
        title: "Unsaved changes",
        message: `"${fileName(path)}" has unsaved changes. Close anyway?`,
        confirmLabel: "Close",
        danger: true,
      });
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

  closeOtherTabs: async (path) => {
    const { tabs } = get();
    const dirtyOthers = tabs.some((t) => t.path !== path && t.dirty);
    if (dirtyOthers) {
      const ok = await get().requestConfirm({
        title: "Close other tabs",
        message: "Close other tabs and discard unsaved changes?",
        confirmLabel: "Close others",
        danger: true,
      });
      if (!ok) return;
    }
    set({
      tabs: get().tabs.filter((t) => t.path === path),
      activePath: path,
    });
  },

  closeAllTabs: async () => {
    if (get().anyDirty()) {
      const ok = await get().requestConfirm({
        title: "Close all tabs",
        message: "Close all tabs and discard unsaved changes?",
        confirmLabel: "Close all",
        danger: true,
      });
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
    if (/\.wasm$/i.test(path)) {
      get().pushToast("info", "Binary .wasm is not saved from the editor");
      return;
    }
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
    const { settings } = get();
    const backend = settings.inferenceBackend ?? "ollama";
    const online = await checkInferenceOnline(
      backend,
      settings.ollamaBaseUrl,
      settings.llamaCppBaseUrl,
    );
    if (!online) {
      set({ ollamaOnline: false, models: [] });
      return;
    }
    try {
      const models = await fetchInferenceModels(
        backend,
        settings.ollamaBaseUrl,
        settings.llamaCppBaseUrl,
      );
      const selected = get().selectedModel;
      const nextSelected = models.includes(selected) ? selected : models[0] ?? "";
      set({
        ollamaOnline: true,
        models,
        selectedModel: nextSelected,
      });
      if (nextSelected && backend === "ollama") {
        const perf = resolvePerfConfig(settings.perfProfile, {
          keepAlive: settings.ollamaKeepAlive,
          numGpu: settings.ollamaNumGpu,
          hyperSpeed: settings.hyperSpeed,
        });
        void warmModel(settings.ollamaBaseUrl, nextSelected, perf.keepAlive);
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
    const ok = await get().requestConfirm({
      title: "Delete",
      message: `Delete "${fileName(path)}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
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
      const ok = await get().requestConfirm({
        title: "Reload from disk",
        message: "Reload and discard unsaved changes?",
        confirmLabel: "Reload",
        danger: true,
      });
      if (!ok) return;
    }
    await get().openFile(activePath, { forceReload: true });
    get().pushToast("info", "Reloaded from disk");
  },
}));
