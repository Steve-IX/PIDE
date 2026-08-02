export interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNode[];
}

export interface OpenTab {
  path: string;
  content: string;
  originalContent: string;
  language: string;
  dirty: boolean;
}

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Exclude<ChatRole, "system">;
  content: string;
}

export type SidebarView =
  | "explorer"
  | "search"
  | "git"
  | "ollama"
  | "settings";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

export type UiDensity = "default" | "compact";

export type PerfProfile = "fast" | "balanced" | "quality";

export type ChatMode = "agent" | "plan" | "debug" | "multitask" | "ask";

export interface AgentModelRoles {
  router: string;
  explore: string;
  planner: string;
  worker: string;
}

export const DEFAULT_AGENT_MODELS: AgentModelRoles = {
  router: "qwen2.5-coder:1.5b",
  explore: "qwen2.5-coder:1.5b",
  planner: "llama3.1:8b",
  worker: "qwen2.5-coder:7b",
};

export interface AppSettings {
  ollamaBaseUrl: string;
  editorFontSize: number;
  attachActiveFile: boolean;
  saveAfterApply: boolean;
  sidebarWidth: number;
  chatWidth: number;
  bottomPanelHeight: number;
  bottomPanelOpen: boolean;
  /** GitHub OAuth App client ID (Device Flow). Empty → use PAT. */
  githubClientId: string;
  /** Built-in id or `imported:<slug>`. */
  themeId: string;
  /** VS Code–style workbench.colorCustomizations overrides. */
  colorCustomizations: Record<string, string>;
  uiFontSize: number;
  uiDensity: UiDensity;
  /** Local LLM latency vs depth. */
  perfProfile: PerfProfile;
  /** 0 = use profile default. */
  maxHistoryMessages: number;
  /** 0 = use profile default. */
  maxAttachChars: number;
  /** Ollama keep_alive string, e.g. "30m". Empty = profile default. */
  ollamaKeepAlive: string;
  /** Optional GPU layer override; null = Ollama default. */
  ollamaNumGpu: number | null;
  /** Chat agent mode (Agent / Plan / Debug / Multitask / Ask). */
  chatMode: ChatMode;
  /** When true, route via Auto (router → specialist). */
  autoModel: boolean;
  /**
   * Models shown in the picker. Empty = all installed models enabled.
   * Disabled models are omitted from the quick picker.
   */
  enabledModels: string[];
  /** Role → preferred Ollama model name. */
  agentModels: AgentModelRoles;
}

export const DEFAULT_SETTINGS: AppSettings = {
  ollamaBaseUrl: "http://127.0.0.1:11434",
  editorFontSize: 14,
  attachActiveFile: true,
  saveAfterApply: true,
  sidebarWidth: 260,
  chatWidth: 380,
  bottomPanelHeight: 220,
  bottomPanelOpen: false,
  githubClientId: "",
  themeId: "pide-dark",
  colorCustomizations: {},
  uiFontSize: 13,
  uiDensity: "default",
  perfProfile: "balanced",
  maxHistoryMessages: 0,
  maxAttachChars: 0,
  ollamaKeepAlive: "",
  ollamaNumGpu: null,
  chatMode: "agent",
  autoModel: true,
  enabledModels: [],
  agentModels: { ...DEFAULT_AGENT_MODELS },
};

export type PaletteMode = "command" | "quickOpen" | "colorTheme" | null;

export interface DiffApplyRequest {
  path: string;
  original: string;
  modified: string;
  language: string;
  isNewFile: boolean;
}

export interface ProblemItem {
  id: string;
  severity: "error" | "warning" | "info";
  source: string;
  message: string;
  path?: string;
  line?: number;
}

export interface RevealRequest {
  path: string;
  line: number;
  column: number;
}
