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
  metrics?: {
    evalCount: number;
    evalDurationNs: number;
    tokensPerSec: number;
    ttftMs?: number;
  };
}

export type InferenceBackend = "ollama" | "llamaCpp";

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

export interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

export interface PromptDialogState {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (value: string | null) => void;
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
  /**
   * Hyper-Speed: tighter context, higher batch, prefer 1.5B for Ask/short Agent,
   * and force Fast-like runtime knobs for Iris Xe throughput.
   */
  hyperSpeed: boolean;
  /** ollama = default; llamaCpp = optional llama-server (ngram speculation). */
  inferenceBackend: InferenceBackend;
  /** llama-server base URL when inferenceBackend is llamaCpp. */
  llamaCppBaseUrl: string;
  /** Path to llama-server executable (managed mode). */
  llamaCppBinaryPath: string;
  /** Path to GGUF model file. */
  llamaCppGgufPath: string;
  /** When true, PIDE owns start/stop/minimize lifecycle. */
  llamaCppManaged: boolean;
  /** -ngl layers for sidecar. */
  llamaCppNumGpu: number;
  /** Context size (-c) for sidecar. */
  llamaCppCtx: number;
  /** KV cache quantization. */
  llamaCppKvCache: "f16" | "q8_0";
  /** Enable ngram-mod speculative decoding on sidecar. */
  llamaCppNgram: boolean;
  /** Stop sidecar when IDE minimized (frees RAM). */
  llamaCppSuspendOnMinimize: boolean;
  /** Monaco inline FIM ghost text (llama.cpp /completion only). */
  ghostTextEnabled: boolean;
  /** Debounce before FIM fetch (ms). */
  ghostTextDebounceMs: number;
  /** Max tokens to predict for ghost text. */
  ghostTextMaxPredict: number;
  /** Sandbox wall-clock limit (seconds). */
  sandboxWallSeconds: number;
  /** Wasmtime guest memory limit (MiB). */
  sandboxWasmMemoryMib: number;
  /** Host Job Object / limited-run memory (MiB). */
  sandboxHostMemoryMib: number;
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
  hyperSpeed: false,
  inferenceBackend: "ollama",
  llamaCppBaseUrl: "http://127.0.0.1:8080",
  llamaCppBinaryPath: "C:\\tools\\llama.cpp\\llama-server.exe",
  llamaCppGgufPath: "C:\\models\\qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
  llamaCppManaged: false,
  llamaCppNumGpu: 99,
  llamaCppCtx: 2048,
  llamaCppKvCache: "q8_0",
  llamaCppNgram: true,
  llamaCppSuspendOnMinimize: true,
  ghostTextEnabled: true,
  ghostTextDebounceMs: 150,
  ghostTextMaxPredict: 64,
  sandboxWallSeconds: 5,
  sandboxWasmMemoryMib: 64,
  sandboxHostMemoryMib: 256,
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
  column?: number;
}

export interface RevealRequest {
  path: string;
  line: number;
  column: number;
}
