import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface PtyDataPayload {
  id: string;
  data: string;
}

export interface PtyExitPayload {
  id: string;
}

export async function ptyCreate(cwd: string, cols: number, rows: number): Promise<string> {
  return invoke<string>("pty_create", {
    cwd,
    cols: Math.max(2, Math.floor(cols)),
    rows: Math.max(2, Math.floor(rows)),
  });
}

export async function ptyWrite(id: string, data: string): Promise<void> {
  await invoke("pty_write", { id, data });
}

export async function ptyResize(id: string, cols: number, rows: number): Promise<void> {
  await invoke("pty_resize", {
    id,
    cols: Math.max(2, Math.floor(cols)),
    rows: Math.max(2, Math.floor(rows)),
  });
}

export async function ptyKill(id: string): Promise<void> {
  await invoke("pty_kill", { id });
}

export function listenPtyData(handler: (payload: PtyDataPayload) => void): Promise<UnlistenFn> {
  return listen<PtyDataPayload>("pty://data", (e) => handler(e.payload));
}

export function listenPtyExit(handler: (payload: PtyExitPayload) => void): Promise<UnlistenFn> {
  return listen<PtyExitPayload>("pty://exit", (e) => handler(e.payload));
}
