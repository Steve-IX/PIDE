import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../types";

export interface LlamaSidecarStartResult {
  pid: number;
  baseUrl: string;
}

export interface LlamaSidecarStatus {
  running: boolean;
  pid?: number | null;
  baseUrl?: string | null;
  healthy: boolean;
  lastError?: string | null;
}

export interface StartLlamaSidecarArgs {
  binaryPath: string;
  ggufPath: string;
  baseUrl: string;
  numGpu: number;
  ctx: number;
  kvCache: string;
  ngram: boolean;
  ngramDraftNMax: number;
}

export function startArgsFromSettings(settings: AppSettings): StartLlamaSidecarArgs {
  return {
    binaryPath: settings.llamaCppBinaryPath,
    ggufPath: settings.llamaCppGgufPath,
    baseUrl: settings.llamaCppBaseUrl || "http://127.0.0.1:8080",
    numGpu: settings.llamaCppNumGpu ?? 99,
    ctx: settings.llamaCppCtx ?? 2048,
    kvCache: settings.llamaCppKvCache ?? "q8_0",
    ngram: settings.llamaCppNgram !== false,
    ngramDraftNMax: 64,
  };
}

export async function startLlamaSidecar(
  args: StartLlamaSidecarArgs,
): Promise<LlamaSidecarStartResult> {
  return invoke("start_llama_sidecar", { args });
}

export async function stopLlamaSidecar(): Promise<void> {
  return invoke("stop_llama_sidecar");
}

export async function llamaSidecarStatus(): Promise<LlamaSidecarStatus> {
  return invoke("llama_sidecar_status");
}

export async function suspendLlamaSidecar(): Promise<void> {
  return invoke("suspend_llama_sidecar");
}

export async function resumeLlamaSidecar(): Promise<LlamaSidecarStartResult | null> {
  return invoke("resume_llama_sidecar");
}

/** Poll until healthy or timeout. */
export async function waitForLlamaHealthy(
  timeoutMs = 45000,
  intervalMs = 500,
): Promise<LlamaSidecarStatus> {
  const start = Date.now();
  let last = await llamaSidecarStatus();
  while (Date.now() - start < timeoutMs) {
    last = await llamaSidecarStatus();
    if (last.healthy) return last;
    if (!last.running && last.lastError) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}
