import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface SandboxResult {
  stdout: string;
  stderr: string;
  code: number;
  timedOut: boolean;
  reason: string;
  kind: string;
}

export interface SandboxChunk {
  stream: string;
  data: string;
}

export async function sandboxRunWasm(args: {
  workspacePath: string;
  wasmPath: string;
  args?: string[];
  stdin?: string;
  wallSeconds?: number;
  wasmMemoryMib?: number;
  fuel?: number;
}): Promise<SandboxResult> {
  return invoke<SandboxResult>("sandbox_run_wasm", {
    args: {
      workspacePath: args.workspacePath,
      wasmPath: args.wasmPath,
      args: args.args ?? [],
      stdin: args.stdin ?? null,
      wallSeconds: args.wallSeconds ?? null,
      wasmMemoryMib: args.wasmMemoryMib ?? null,
      fuel: args.fuel ?? null,
    },
  });
}

export async function sandboxRunLimited(args: {
  workspacePath: string;
  program: string;
  args?: string[];
  cwd?: string;
  wallSeconds?: number;
  hostMemoryMib?: number;
}): Promise<SandboxResult> {
  return invoke<SandboxResult>("sandbox_run_limited", {
    args: {
      workspacePath: args.workspacePath,
      program: args.program,
      args: args.args ?? [],
      cwd: args.cwd ?? null,
      wallSeconds: args.wallSeconds ?? null,
      hostMemoryMib: args.hostMemoryMib ?? null,
    },
  });
}

export async function sandboxCancel(): Promise<void> {
  await invoke("sandbox_cancel");
}

export async function sandboxIsActive(): Promise<boolean> {
  return invoke<boolean>("sandbox_is_active");
}

export function listenSandboxChunks(
  handler: (chunk: SandboxChunk) => void,
): Promise<UnlistenFn> {
  return listen<SandboxChunk>("sandbox://chunk", (e) => handler(e.payload));
}
