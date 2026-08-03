import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface DapMessagePayload {
  kind: string;
  body: Record<string, unknown>;
}

export async function dapStart(args: {
  adapterCommand: string;
  adapterArgs: string[];
  cwd?: string;
}): Promise<void> {
  await invoke("dap_start", {
    args: {
      adapterCommand: args.adapterCommand,
      adapterArgs: args.adapterArgs,
      cwd: args.cwd ?? null,
    },
  });
}

export async function dapRequest(
  command: string,
  arguments_?: Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("dap_request", {
    args: {
      command,
      arguments: arguments_ ?? null,
    },
  });
}

export async function dapStop(): Promise<void> {
  await invoke("dap_stop");
}

export async function dapIsActive(): Promise<boolean> {
  return invoke<boolean>("dap_is_active");
}

export function listenDapMessages(
  handler: (payload: DapMessagePayload) => void,
): Promise<UnlistenFn> {
  return listen<DapMessagePayload>("dap://message", (e) => handler(e.payload));
}

export async function dapInitialize(): Promise<Record<string, unknown>> {
  return dapRequest("initialize", {
    clientID: "pide",
    clientName: "PIDE",
    adapterID: "pide",
    pathFormat: "path",
    linesStartAt1: true,
    columnsStartAt1: true,
    supportsVariableType: true,
    supportsVariablePaging: false,
    supportsRunInTerminalRequest: false,
  });
}

export async function dapLaunch(args: Record<string, unknown>) {
  return dapRequest("launch", args);
}

export async function dapAttach(args: Record<string, unknown>) {
  return dapRequest("attach", args);
}

export async function dapConfigurationDone() {
  return dapRequest("configurationDone", {});
}

/** Normalize paths for DAP adapters (esp. debugpy on Windows). */
export function normalizeDapPath(path: string): string {
  let p = path.trim();
  if (p.startsWith("\\\\?\\")) p = p.slice(4);
  if (p.startsWith("//?/")) p = p.slice(4);
  // Prefer backslashes on Windows-style paths
  if (/^[a-zA-Z]:/.test(p) || p.includes("\\")) {
    p = p.replace(/\//g, "\\");
    p = p[0].toUpperCase() + p.slice(1);
  }
  return p;
}

function fileNameOf(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

export async function dapSetBreakpoints(
  sourcePath: string,
  lines: number[],
): Promise<Record<string, unknown>> {
  const path = normalizeDapPath(sourcePath);
  return dapRequest("setBreakpoints", {
    source: { path, name: fileNameOf(path) },
    breakpoints: lines.map((line) => ({ line })),
    sourceModified: false,
  });
}

/** Apply editor breakpoints; prefer launch `program` path when it's the same file. */
export async function dapApplyBreakpoints(
  breakpoints: Record<string, number[]>,
  programPath?: string | null,
): Promise<{ verified: number; total: number; details: string[] }> {
  const program = programPath ? normalizeDapPath(programPath) : null;
  const details: string[] = [];
  let verified = 0;
  let total = 0;

  for (const [rawPath, lines] of Object.entries(breakpoints)) {
    if (!lines.length) continue;
    let path = normalizeDapPath(rawPath);
    if (
      program &&
      path.toLowerCase() === program.toLowerCase()
    ) {
      path = program;
    } else if (
      program &&
      fileNameOf(path).toLowerCase() === fileNameOf(program).toLowerCase()
    ) {
      // Same basename under workspace — bind to launched program path
      path = program;
    }

    const resp = await dapSetBreakpoints(path, lines);
    const body = (resp.body ?? {}) as {
      breakpoints?: Array<{ line?: number; verified?: boolean; message?: string }>;
    };
    const bps = body.breakpoints ?? [];
    for (let i = 0; i < lines.length; i++) {
      total++;
      const bp = bps[i];
      const ok = bp?.verified === true;
      if (ok) verified++;
      const msg = bp?.message ? ` (${bp.message})` : "";
      details.push(
        `${path}:${lines[i]} → ${ok ? "verified" : "NOT verified"}${msg}`,
      );
    }
  }

  return { verified, total, details };
}

export async function dapContinue(threadId: number) {
  return dapRequest("continue", { threadId });
}

export async function dapNext(threadId: number) {
  return dapRequest("next", { threadId });
}

export async function dapStepIn(threadId: number) {
  return dapRequest("stepIn", { threadId });
}

export async function dapStepOut(threadId: number) {
  return dapRequest("stepOut", { threadId });
}

export async function dapStackTrace(threadId: number) {
  return dapRequest("stackTrace", { threadId, startFrame: 0, levels: 40 });
}

export async function dapScopes(frameId: number) {
  return dapRequest("scopes", { frameId });
}

export async function dapVariables(variablesReference: number) {
  return dapRequest("variables", { variablesReference });
}

export async function dapDisconnect() {
  return dapRequest("disconnect", { terminateDebuggee: true });
}
