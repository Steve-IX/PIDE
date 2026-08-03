import type { InferenceBackend } from "../types";
import {
  chatStream,
  checkOllamaOnline,
  fetchModels,
  warmModel,
  type ChatStreamResult,
  type OllamaChatMessage,
  type OllamaChatOptions,
  type StreamChatOptions,
} from "./ollama";
import {
  checkLlamaCppOnline,
  fetchLlamaCppModels,
  llamaCppChatStream,
} from "./llamaCpp";

export interface UnifiedStreamArgs {
  backend: InferenceBackend;
  ollamaBaseUrl: string;
  llamaCppBaseUrl: string;
  model: string;
  messages: OllamaChatMessage[];
  signal?: AbortSignal;
  onToken: (token: string) => void;
  keepAlive?: string;
  options?: OllamaChatOptions;
}

export async function unifiedChatStream(args: UnifiedStreamArgs): Promise<ChatStreamResult> {
  if (args.backend === "llamaCpp") {
    return llamaCppChatStream({
      baseUrl: args.llamaCppBaseUrl,
      model: args.model,
      messages: args.messages,
      signal: args.signal,
      onToken: args.onToken,
      options: args.options,
    });
  }
  const opts: StreamChatOptions = {
    baseUrl: args.ollamaBaseUrl,
    model: args.model,
    messages: args.messages,
    signal: args.signal,
    onToken: args.onToken,
    keepAlive: args.keepAlive,
    options: args.options,
  };
  return chatStream(opts);
}

export async function checkInferenceOnline(
  backend: InferenceBackend,
  ollamaBaseUrl: string,
  llamaCppBaseUrl: string,
): Promise<boolean> {
  if (backend === "llamaCpp") return checkLlamaCppOnline(llamaCppBaseUrl);
  return checkOllamaOnline(ollamaBaseUrl);
}

export async function fetchInferenceModels(
  backend: InferenceBackend,
  ollamaBaseUrl: string,
  llamaCppBaseUrl: string,
): Promise<string[]> {
  if (backend === "llamaCpp") return fetchLlamaCppModels(llamaCppBaseUrl);
  return fetchModels(ollamaBaseUrl);
}

export async function warmInferenceModel(args: {
  backend: InferenceBackend;
  ollamaBaseUrl: string;
  model: string;
  keepAlive: string;
}): Promise<void> {
  if (args.backend === "llamaCpp") return;
  await warmModel(args.ollamaBaseUrl, args.model, args.keepAlive);
}
