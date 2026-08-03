import type { PerfProfile } from "../types";

export interface OllamaRuntimeOptions {
  num_ctx: number;
  num_predict: number;
  temperature: number;
  top_p: number;
  num_batch?: number;
  num_gpu?: number;
}

export interface PerfProfileConfig {
  label: string;
  description: string;
  keepAlive: string;
  maxHistoryMessages: number;
  maxAttachChars: number;
  options: OllamaRuntimeOptions;
}

export const PERF_PROFILES: Record<PerfProfile, PerfProfileConfig> = {
  fast: {
    label: "Fast",
    description: "Lowest latency — shorter context and replies",
    keepAlive: "30m",
    maxHistoryMessages: 8,
    maxAttachChars: 6000,
    options: {
      num_ctx: 4096,
      num_predict: 1024,
      temperature: 0.5,
      top_p: 0.9,
      num_batch: 512,
    },
  },
  balanced: {
    label: "Balanced",
    description: "Good speed with enough room for coding tasks",
    keepAlive: "30m",
    maxHistoryMessages: 16,
    maxAttachChars: 10000,
    options: {
      num_ctx: 8192,
      num_predict: 2048,
      temperature: 0.4,
      top_p: 0.9,
      num_batch: 512,
    },
  },
  quality: {
    label: "Quality",
    description: "Longer context and replies for harder refactors",
    keepAlive: "45m",
    maxHistoryMessages: 28,
    maxAttachChars: 16000,
    options: {
      num_ctx: 16384,
      num_predict: 4096,
      temperature: 0.3,
      top_p: 0.95,
      num_batch: 256,
    },
  },
};

/** Hyper-Speed overrides aimed at Iris Xe / 16GB (1.5B path toward 40–70 tok/s). */
export const HYPER_SPEED_OVERRIDES: Pick<
  PerfProfileConfig,
  "maxHistoryMessages" | "maxAttachChars" | "keepAlive" | "options"
> = {
  keepAlive: "45m",
  maxHistoryMessages: 6,
  maxAttachChars: 4000,
  options: {
    num_ctx: 2048,
    num_predict: 768,
    temperature: 0.4,
    top_p: 0.9,
    num_batch: 1024,
    num_gpu: 99,
  },
};

export function resolvePerfConfig(
  profile: PerfProfile,
  overrides?: {
    maxHistoryMessages?: number;
    maxAttachChars?: number;
    keepAlive?: string;
    numGpu?: number | null;
    hyperSpeed?: boolean;
  },
): PerfProfileConfig {
  const base = PERF_PROFILES[profile] ?? PERF_PROFILES.balanced;
  let options: OllamaRuntimeOptions = { ...base.options };
  let maxHistoryMessages = base.maxHistoryMessages;
  let maxAttachChars = base.maxAttachChars;
  let keepAlive = base.keepAlive;

  if (overrides?.hyperSpeed) {
    options = { ...HYPER_SPEED_OVERRIDES.options };
    maxHistoryMessages = HYPER_SPEED_OVERRIDES.maxHistoryMessages;
    maxAttachChars = HYPER_SPEED_OVERRIDES.maxAttachChars;
    keepAlive = HYPER_SPEED_OVERRIDES.keepAlive;
  }

  if (overrides?.numGpu != null && overrides.numGpu >= 0) {
    options.num_gpu = overrides.numGpu;
  } else if (overrides?.hyperSpeed && options.num_gpu == null) {
    options.num_gpu = 99;
  }

  return {
    ...base,
    keepAlive: overrides?.keepAlive?.trim() || keepAlive,
    maxHistoryMessages:
      overrides?.maxHistoryMessages && overrides.maxHistoryMessages > 0
        ? overrides.maxHistoryMessages
        : maxHistoryMessages,
    maxAttachChars:
      overrides?.maxAttachChars && overrides.maxAttachChars > 0
        ? overrides.maxAttachChars
        : maxAttachChars,
    options,
  };
}
