export const SYSTEM_PROMPT =
  "You are PIDE's local coding assistant (Ollama). Be direct and practical — no filler or preambles. " +
  "Prefer the smallest correct change: for edits to existing files, return a targeted fenced code snippet or a unified diff, not the entire file, unless the user asks to rewrite the whole file. " +
  "For new files, return the full file in one fenced block with a language tag. " +
  "When creating or changing multiple files, emit one fenced block per file and label each with a path on the preceding line as `// path: relative/path.ext` (or `# path:` for scripts). " +
  "Use workspace-relative paths. Treat @file mentions and the active file as authoritative context. " +
  "Keep explanations short; put code in fences.";

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaChatOptions {
  num_ctx?: number;
  num_predict?: number;
  temperature?: number;
  top_p?: number;
  num_batch?: number;
  num_gpu?: number;
}

interface TagsResponse {
  models?: Array<{ name: string }>;
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export async function checkOllamaOnline(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${normalizeBase(baseUrl)}/api/tags`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchModels(baseUrl: string): Promise<string[]> {
  const res = await fetch(`${normalizeBase(baseUrl)}/api/tags`);
  if (!res.ok) {
    throw new Error(`Ollama returned ${res.status}. Is Ollama running?`);
  }
  const data = (await res.json()) as TagsResponse;
  return (data.models ?? []).map((m) => m.name).sort((a, b) => a.localeCompare(b));
}

/** Keep the model loaded in VRAM/RAM so the next chat is fast. */
export async function warmModel(
  baseUrl: string,
  model: string,
  keepAlive = "30m",
): Promise<void> {
  if (!model) return;
  try {
    await fetch(`${normalizeBase(baseUrl)}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: "",
        keep_alive: keepAlive,
        stream: false,
        options: { num_predict: 0 },
      }),
    });
  } catch {
    /* warmup is best-effort */
  }
}

export interface StreamChatOptions {
  baseUrl: string;
  model: string;
  messages: OllamaChatMessage[];
  signal?: AbortSignal;
  onToken: (token: string) => void;
  keepAlive?: string;
  options?: OllamaChatOptions;
}

export async function chatStream(options: StreamChatOptions): Promise<string> {
  const {
    baseUrl,
    model,
    messages,
    signal,
    onToken,
    keepAlive = "30m",
    options: runtime,
  } = options;

  const res = await fetch(`${normalizeBase(baseUrl)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      keep_alive: keepAlive,
      options: runtime
        ? {
            num_ctx: runtime.num_ctx,
            num_predict: runtime.num_predict,
            temperature: runtime.temperature,
            top_p: runtime.top_p,
            ...(runtime.num_batch != null ? { num_batch: runtime.num_batch } : {}),
            ...(runtime.num_gpu != null ? { num_gpu: runtime.num_gpu } : {}),
          }
        : undefined,
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Ollama chat failed (${res.status})`);
  }

  if (!res.body) {
    throw new Error("No response body from Ollama");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const json = JSON.parse(trimmed) as {
          message?: { content?: string };
          done?: boolean;
          error?: string;
        };
        if (json.error) throw new Error(json.error);
        const token = json.message?.content ?? "";
        if (token) {
          full += token;
          onToken(token);
        }
      } catch (err) {
        if (err instanceof SyntaxError) continue;
        throw err;
      }
    }
  }

  if (buffer.trim()) {
    try {
      const json = JSON.parse(buffer.trim()) as {
        message?: { content?: string };
        error?: string;
      };
      if (json.error) throw new Error(json.error);
      const token = json.message?.content ?? "";
      if (token) {
        full += token;
        onToken(token);
      }
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
    }
  }

  return full;
}
