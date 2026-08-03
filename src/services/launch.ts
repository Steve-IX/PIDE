import { fileName, joinPath, readFile } from "./fs";

export type LaunchRequest = "launch" | "attach";

export interface PideLaunchConfig {
  name: string;
  type: string;
  request: LaunchRequest;
  program?: string;
  args?: string[];
  cwd?: string;
  stopOnEntry?: boolean;
  console?: string;
  /** Override adapter binary (any type). */
  debugAdapterExecutable?: string;
  debugAdapterArgs?: string[];
  /** Extra DAP launch/attach fields passed through. */
  [key: string]: unknown;
}

interface RawLaunchFile {
  version?: string;
  configurations?: unknown[];
}

function parseConfig(raw: unknown): PideLaunchConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.name !== "string" || !c.name.trim()) return null;
  if (typeof c.type !== "string" || !c.type.trim()) return null;
  const request = c.request === "attach" ? "attach" : "launch";
  return { ...(c as PideLaunchConfig), name: c.name.trim(), type: c.type.trim(), request };
}

async function readLaunchFile(
  workspacePath: string,
  relativeJson: string,
): Promise<PideLaunchConfig[]> {
  const path = joinPath(workspacePath, relativeJson);
  try {
    const text = await readFile(workspacePath, path);
    const data = JSON.parse(text) as RawLaunchFile;
    if (!Array.isArray(data.configurations)) return [];
    return data.configurations
      .map(parseConfig)
      .filter((c): c is PideLaunchConfig => Boolean(c));
  } catch {
    return [];
  }
}

export async function loadWorkspaceLaunchConfigs(
  workspacePath: string,
): Promise<PideLaunchConfig[]> {
  if (!workspacePath) return [];
  const fromVscode = await readLaunchFile(workspacePath, ".vscode/launch.json");
  const fromPide = await readLaunchFile(workspacePath, ".pide/launch.json");
  const map = new Map<string, PideLaunchConfig>();
  for (const c of fromVscode) map.set(c.name, c);
  for (const c of fromPide) map.set(c.name, c);
  return [...map.values()];
}

/**
 * Multi-language launch seed for new workspaces.
 * Adapters are discovered on PATH (not bundled). Prefer Ctrl+F5 to run without a debugger.
 */
export const DEFAULT_LAUNCH_JSON = `{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Python: current file",
      "type": "python",
      "request": "launch",
      "program": "\${file}",
      "console": "internalConsole",
      "stopOnEntry": false
    },
    {
      "name": "Node: current file",
      "type": "node",
      "request": "launch",
      "program": "\${file}",
      "console": "internalConsole",
      "stopOnEntry": false
    },
    {
      "name": "TypeScript / JS: current file (node)",
      "type": "node",
      "request": "launch",
      "program": "\${file}",
      "console": "internalConsole",
      "stopOnEntry": false,
      "runtimeArgs": ["--import", "tsx"]
    },
    {
      "name": "Go: current file",
      "type": "go",
      "request": "launch",
      "program": "\${file}",
      "mode": "debug",
      "console": "internalConsole",
      "stopOnEntry": false
    },
    {
      "name": "Rust: current binary (lldb)",
      "type": "lldb",
      "request": "launch",
      "program": "\${file}",
      "console": "internalConsole",
      "stopOnEntry": false
    },
    {
      "name": "C/C++: current file (lldb)",
      "type": "lldb",
      "request": "launch",
      "program": "\${file}",
      "console": "internalConsole",
      "stopOnEntry": false
    },
    {
      "name": "Java: current file",
      "type": "java",
      "request": "launch",
      "mainClass": "\${file}",
      "console": "internalConsole",
      "stopOnEntry": false
    },
    {
      "name": "Ruby: current file",
      "type": "ruby",
      "request": "launch",
      "program": "\${file}",
      "console": "internalConsole",
      "stopOnEntry": false
    },
    {
      "name": "PHP: current file",
      "type": "php",
      "request": "launch",
      "program": "\${file}",
      "console": "internalConsole",
      "stopOnEntry": false
    },
    {
      "name": "PowerShell: current file",
      "type": "PowerShell",
      "request": "launch",
      "script": "\${file}",
      "console": "internalConsole",
      "stopOnEntry": false
    }
  ]
}
`;

/**
 * Ensure `.vscode/launch.json` exists with multi-language configs.
 * - Missing file → create full default seed.
 * - Existing file → merge in any default configs whose `name` is not already present
 *   (never deletes or overwrites user entries).
 */
export async function ensureDefaultLaunchJson(
  workspacePath: string,
): Promise<boolean> {
  if (!workspacePath) return false;

  const { createFile, writeFile } = await import("./fs");
  const path = joinPath(workspacePath, ".vscode/launch.json");
  const defaults = JSON.parse(DEFAULT_LAUNCH_JSON) as RawLaunchFile;
  const defaultConfigs = Array.isArray(defaults.configurations)
    ? defaults.configurations
    : [];

  let existingRaw: unknown[] = [];
  let fileExists = false;
  try {
    const text = await readFile(workspacePath, path);
    fileExists = true;
    const data = JSON.parse(text) as RawLaunchFile;
    if (Array.isArray(data.configurations)) existingRaw = data.configurations;
  } catch {
    fileExists = false;
  }

  if (!fileExists) {
    try {
      await createFile(workspacePath, path, DEFAULT_LAUNCH_JSON);
      return true;
    } catch {
      return false;
    }
  }

  const names = new Set<string>();
  for (const raw of existingRaw) {
    if (raw && typeof raw === "object" && typeof (raw as { name?: unknown }).name === "string") {
      names.add((raw as { name: string }).name);
    }
  }

  const merged = [...existingRaw];
  let added = 0;
  for (const cfg of defaultConfigs) {
    if (!cfg || typeof cfg !== "object") continue;
    const name = (cfg as { name?: unknown }).name;
    if (typeof name !== "string" || names.has(name)) continue;
    merged.push(cfg);
    names.add(name);
    added++;
  }
  if (added === 0) return false;

  const next = `${JSON.stringify({ version: "0.2.0", configurations: merged }, null, 2)}\n`;
  try {
    await writeFile(workspacePath, path, next);
    return true;
  } catch {
    return false;
  }
}

export interface ResolvedAdapter {
  adapterCommand: string;
  adapterArgs: string[];
  cwd: string;
  /** Arguments for DAP launch or attach request. */
  requestArgs: Record<string, unknown>;
  request: LaunchRequest;
}

function resolveProgram(workspacePath: string, program?: string): string | undefined {
  if (!program) return undefined;
  if (/^[a-zA-Z]:[\\/]/.test(program) || program.startsWith("/")) return program;
  return joinPath(workspacePath, program.replace(/^\.[/\\]/, ""));
}

function expandLaunchVars(
  value: string | undefined,
  workspacePath: string,
  activeFilePath?: string | null,
): string | undefined {
  if (!value) return value;
  let out = value.replace(/\$\{workspaceFolder\}/g, workspacePath);
  if (activeFilePath) {
    out = out.replace(/\$\{file\}/g, activeFilePath);
  }
  return out;
}

function extOf(path: string | null | undefined): string {
  if (!path) return "";
  const n = fileName(path);
  const i = n.lastIndexOf(".");
  return i >= 0 ? n.slice(i + 1).toLowerCase() : "";
}

/** Map active file → preferred launch config type(s), first match wins. */
function preferredTypesForFile(activeFilePath?: string | null): string[] {
  const ext = extOf(activeFilePath);
  switch (ext) {
    case "py":
    case "pyw":
      return ["python", "debugpy"];
    case "js":
    case "mjs":
    case "cjs":
      return ["node", "pwa-node", "javascript"];
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return ["node", "pwa-node", "typescript"];
    case "go":
      return ["go"];
    case "rs":
      return ["lldb", "cppdbg", "codelldb", "rust"];
    case "c":
    case "cc":
    case "cpp":
    case "cxx":
    case "h":
    case "hpp":
      return ["lldb", "cppdbg", "codelldb", "cpp"];
    case "java":
      return ["java"];
    case "rb":
      return ["ruby", "rdbg"];
    case "php":
      return ["php"];
    case "ps1":
      return ["powershell", "PowerShell"];
    case "cs":
      return ["coreclr", "clr"];
    default:
      return [];
  }
}

/** Resolve how to spawn the DAP adapter + launch/attach args. */
export function resolveLaunchAdapter(
  config: PideLaunchConfig,
  workspacePath: string,
  activeFilePath?: string | null,
): ResolvedAdapter {
  const cwdRaw = expandLaunchVars(config.cwd, workspacePath, activeFilePath);
  const cwd = cwdRaw
    ? resolveProgram(workspacePath, cwdRaw) ?? workspacePath
    : workspacePath;

  const programRaw = expandLaunchVars(
    config.program ?? (typeof config.script === "string" ? config.script : undefined),
    workspacePath,
    activeFilePath,
  );
  const program = resolveProgram(workspacePath, programRaw);
  const requestArgs: Record<string, unknown> = {
    name: config.name,
    type: config.type,
    request: config.request,
    program,
    args: config.args ?? [],
    cwd,
    stopOnEntry: config.stopOnEntry ?? false,
    console: config.console ?? "internalConsole",
  };

  for (const [k, v] of Object.entries(config)) {
    if (
      [
        "name",
        "type",
        "request",
        "program",
        "script",
        "args",
        "cwd",
        "stopOnEntry",
        "console",
        "debugAdapterExecutable",
        "debugAdapterArgs",
      ].includes(k)
    ) {
      continue;
    }
    requestArgs[k] = v;
  }
  if (typeof config.script === "string" && !requestArgs.script) {
    requestArgs.script = expandLaunchVars(config.script, workspacePath, activeFilePath);
  }

  if (config.debugAdapterExecutable) {
    return {
      adapterCommand: config.debugAdapterExecutable,
      adapterArgs: config.debugAdapterArgs ?? [],
      cwd,
      requestArgs,
      request: config.request,
    };
  }

  const t = config.type.toLowerCase();

  if (t === "python" || t === "debugpy") {
    return {
      adapterCommand: "python",
      adapterArgs: ["-u", "-m", "debugpy.adapter"],
      cwd,
      requestArgs: {
        ...requestArgs,
        python: requestArgs.python ?? "python",
        // No DAP runInTerminal yet — integratedTerminal hangs "Starting…"
        console: "internalConsole",
        justMyCode: requestArgs.justMyCode ?? true,
      },
      request: config.request,
    };
  }

  if (t === "go") {
    return {
      adapterCommand: "dlv",
      adapterArgs: ["dap"],
      cwd,
      requestArgs: {
        ...requestArgs,
        mode: requestArgs.mode ?? "debug",
      },
      request: config.request,
    };
  }

  if (t === "lldb" || t === "lldb-dap" || t === "codelldb" || t === "cppdbg" || t === "cpp") {
    // LLVM lldb-dap (stdio). CodeLLDB / cppvsdbg need debugAdapterExecutable override.
    return {
      adapterCommand: "lldb-dap",
      adapterArgs: [],
      cwd,
      requestArgs,
      request: config.request,
    };
  }

  if (t === "node" || t === "pwa-node" || t === "javascript" || t === "typescript") {
    throw new Error(
      `Node/TS DAP needs a js-debug adapter. Set debugAdapterExecutable in launch.json, or press Ctrl+F5 to run without debugging. Tip: install debugpy-style host tools for Python; for Node use VS Code js-debug path or Ctrl+F5.`,
    );
  }

  if (t === "java") {
    throw new Error(
      `Java DAP needs a language server adapter. Set debugAdapterExecutable, or press Ctrl+F5 to compile/run with javac/java.`,
    );
  }

  if (t === "ruby" || t === "rdbg") {
    throw new Error(
      `Ruby DAP needs rdbg/vscode-rdbg (often TCP). Set debugAdapterExecutable, or use Ctrl+F5 to run with ruby.`,
    );
  }

  if (t === "php") {
    throw new Error(
      `PHP DAP needs vscode-php-debug (or set debugAdapterExecutable). Use Ctrl+F5 to run with php.`,
    );
  }

  if (t === "powershell") {
    throw new Error(
      `PowerShell DAP needs the PowerShell extension adapter. Use Ctrl+F5 to run the script.`,
    );
  }

  if (t === "coreclr" || t === "clr") {
    throw new Error(
      `Set debugAdapterExecutable to netcoredbg (or similar) for .NET, or use Ctrl+F5 / dotnet run.`,
    );
  }

  throw new Error(
    `No built-in debug adapter for type "${config.type}". Set debugAdapterExecutable + debugAdapterArgs in launch.json, or use Ctrl+F5 to run.`,
  );
}

/**
 * Prefer a launch config matching the active file's language; else first config.
 */
export function pickDefaultLaunchConfig(
  configs: PideLaunchConfig[],
  activeFilePath?: string | null,
): PideLaunchConfig | null {
  if (!configs.length) return null;
  const preferred = preferredTypesForFile(activeFilePath);
  if (preferred.length) {
    const hit = configs.find((c) => {
      const ct = c.type.toLowerCase();
      return preferred.some((p) => p.toLowerCase() === ct);
    });
    if (hit) return hit;
    const byName = configs.find((c) => {
      const n = c.name.toLowerCase();
      const ext = extOf(activeFilePath);
      return Boolean(ext && n.includes(ext));
    });
    if (byName) return byName;
  }
  return configs[0] ?? null;
}
