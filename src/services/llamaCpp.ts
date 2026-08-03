import type { ChatMetrics, ChatStreamResult, OllamaChatMessage, OllamaChatOptions } from "./ollama";
import { tokensPerSecond } from "./ollama";

function normalizeBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export async function checkLlamaCppOnline(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${normalizeBase(baseUrl)}/health`, { method: "GET" });
    if (res.ok) return true;
  } catch {
    /* try OpenAI models next */
  }
  try {
    const res = await fetch(`${normalizeBase(baseUrl)}/v1/models`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchLlamaCppModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${normalizeBase(baseUrl)}/v1/models`);
  if (!res.ok) {
    throw new Error(`llama-server returned ${res.status}. Is it running?`);
  }
  const data = (await res.json()) as { data?: Array<{ id?: string }> };
  return (data.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id))
    .sort((a, b) => a.localeCompare(b));
}

interface OpenAiStreamChunk {
  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
  usage?: {
    completion_tokens?: number;
    prompt_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: unknown;
  };
  timings?: {
    predicted_n?: number;
    predicted_ms?: number;
    prompt_n?: number;
    prompt_ms?: number;
  };
}

function metricsFromLlamaChunk(json: OpenAiStreamChunk): ChatMetrics | undefined {
  const t = json.timings;
  if (t?.predicted_n != null && t.predicted_ms != null && t.predicted_ms > 0) {
    const evalDurationNs = t.predicted_ms * 1e6;
    return {
      evalCount: t.predicted_n,
      evalDurationNs,
      tokensPerSec: tokensPerSecond(t.predicted_n, evalDurationNs),
      promptEvalCount: t.prompt_n,
      promptEvalDurationNs: t.prompt_ms != null ? t.prompt_ms * 1e6 : undefined,
      ttftMs: t.prompt_ms,
    };
  }
  const usage = json.usage;
  if (usage?.completion_tokens != null && usage.completion_tokens > 0) {
    // OpenAI-compat without timings: cannot compute real tok/s — omit badge.
    return undefined;
  }
  return undefined;
}

export interface LlamaCppStreamOptions {
  baseUrl: string;
  model: string;
  messages: OllamaChatMessage[];
  signal?: AbortSignal;
  onToken: (token: string) => void;
  options?: OllamaChatOptions;
}

/** Stream via llama-server OpenAI-compatible /v1/chat/completions. */
export async function llamaCppChatStream(
  opts: LlamaCppStreamOptions,
): Promise<ChatStreamResult> {
  const { baseUrl, model, messages, signal, onToken, options: runtime } = opts;

  const res = await fetch(`${normalizeBase(baseUrl)}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || "default",
      messages,
      stream: true,
      temperature: runtime?.temperature ?? 0.4,
      top_p: runtime?.top_p ?? 0.9,
      max_tokens: runtime?.num_predict ?? 2048,
      // Ask llama.cpp to include timings in the final chunk when supported
      stream_options: { include_usage: true },
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `llama-server chat failed (${res.status})`);
  }
  if (!res.body) throw new Error("No response body from llama-server");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let metrics: ChatMetrics | undefined;
  const t0 = performance.now();
  let firstTokenAt: number | null = null;
  let tokenCount = 0;

  function ingestData(payload: string) {
    if (payload === "[DONE]") return;
    let json: OpenAiStreamChunk;
    try {
      json = JSON.parse(payload) as OpenAiStreamChunk;
    } catch {
      return;
    }
    const delta = json.choices?.[0]?.delta?.content ?? "";
    if (delta) {
      if (firstTokenAt == null) firstTokenAt = performance.now();
      tokenCount += 1;
      full += delta;
      onToken(delta);
    }
    const fromServer = metricsFromLlamaChunk(json);
    if (fromServer) metrics = fromServer;
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      ingestData(trimmed.slice(5).trim());
    }
  }
  if (buffer.trim().startsWith("data:")) {
    ingestData(buffer.trim().slice(5).trim());
  }

  // Fallback client-side estimate if server omitted timings (rough; only when we have content)
  if (!metrics && full && firstTokenAt != null) {
    const genMs = Math.max(1, performance.now() - firstTokenAt);
    // Approximate tokens ≈ words * 1.3 when server didn't give eval_count
    const approxTokens = Math.max(tokenCount, Math.ceil(full.split(/\s+/).length * 1.3));
    const evalDurationNs = genMs * 1e6;
    metrics = {
      evalCount: approxTokens,
      evalDurationNs,
      tokensPerSec: tokensPerSecond(approxTokens, evalDurationNs),
      ttftMs: firstTokenAt - t0,
    };
  }

  return { text: full, metrics };
}

/** Qwen2.5-Coder FIM special tokens (IDs 151659 / 151661 / 151660). */
export function buildQwenFimPrompt(prefix: string, suffix: string): string {
  return `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;
}

const FIM_STOP = [
  "<|fim_prefix|>",
  "<|fim_suffix|>",
  "<|fim_middle|>",
  "<|file_sep|>",
  "<|repo_name|>",
  "<|fim_pad|>",
  "<|endoftext|>",
];

function stripFimArtifacts(text: string): string {
  let out = text;
  for (const tok of FIM_STOP) {
    const idx = out.indexOf(tok);
    if (idx >= 0) out = out.slice(0, idx);
  }
  return out.replace(/\0/g, "").trimEnd();
}

export interface LlamaCppFimOptions {
  baseUrl: string;
  prompt: string;
  signal?: AbortSignal;
  nPredict?: number;
  temperature?: number;
}

/**
 * Non-streaming completion via llama-server native /completion (FIM-friendly).
 */
export async function llamaCppFimCompletion(opts: LlamaCppFimOptions): Promise<string> {
  const { baseUrl, prompt, signal, nPredict = 64, temperature = 0.2 } = opts;

  const res = await fetch(`${normalizeBase(baseUrl)}/completion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      n_predict: nPredict,
      temperature,
      stream: false,
      stop: FIM_STOP,
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `llama-server /completion failed (${res.status})`);
  }

  const data = (await res.json()) as { content?: string; generation?: string };
  const raw = data.content ?? data.generation ?? "";
  return stripFimArtifacts(raw);
}
