import type { AgentModelRoles, ChatMode } from "../types";
import { DEFAULT_AGENT_MODELS } from "../types";
import {
  chatStream,
  type OllamaChatMessage,
  type OllamaChatOptions,
  warmModel,
} from "./ollama";

export type RouteIntent = "code" | "plan" | "debug" | "ask";

export interface MultitaskItem {
  id: string;
  title: string;
  prompt: string;
}

const ROUTER_SYSTEM =
  "Classify the user request into exactly one label. Reply with ONLY one word: code, plan, debug, or ask. " +
  "code = implement/edit/write code. plan = architecture/design/checklist. debug = fix errors/bugs. ask = explain/question.";

const PLAN_ADDENDUM =
  "\n\nYou are in Plan mode. Produce a clear markdown checklist of steps. Do not write large code dumps unless a tiny example is essential.";

const DEBUG_ADDENDUM =
  "\n\nYou are in Debug mode. Diagnose the issue, list likely causes, then give a minimal fix (snippet or diff).";

const MULTITASK_PLAN_SYSTEM =
  "You are a task planner. Split the user request into 2–6 concrete coding subtasks. " +
  "Reply with ONLY a JSON array (no markdown fences) of objects: " +
  '[{"id":"1","title":"short title","prompt":"detailed instruction for a coding agent"}].';

export function pickInstalled(
  preferred: string,
  installed: string[],
  fallbacks: string[] = [],
): string {
  const pool = [preferred, ...fallbacks, ...installed];
  for (const name of pool) {
    if (!name) continue;
    const hit =
      installed.find((m) => m === name) ||
      installed.find((m) => m.startsWith(`${name}-`)) ||
      installed.find((m) => m.startsWith(name.split(":")[0] ?? name));
    if (hit) return hit;
  }
  return installed[0] ?? preferred;
}

export function resolveRoleModel(
  role: keyof AgentModelRoles,
  roles: AgentModelRoles,
  installed: string[],
): string {
  const preferred = roles[role] || DEFAULT_AGENT_MODELS[role];
  const order: Record<keyof AgentModelRoles, string[]> = {
    router: [DEFAULT_AGENT_MODELS.router, "qwen2.5-coder:1.5b", "qwen2.5:1.5b"],
    explore: [DEFAULT_AGENT_MODELS.explore, DEFAULT_AGENT_MODELS.router],
    planner: [DEFAULT_AGENT_MODELS.planner, "llama3.1:8b", "llama3:8b"],
    worker: [DEFAULT_AGENT_MODELS.worker, "qwen2.5-coder:7b", "dolphin-llama3:8b"],
  };
  return pickInstalled(preferred, installed, order[role]);
}

export function enabledModelList(
  installed: string[],
  enabledModels: string[],
): string[] {
  if (!enabledModels.length) return installed;
  const set = new Set(enabledModels);
  const filtered = installed.filter((m) => set.has(m));
  return filtered.length ? filtered : installed;
}

/** Map chat mode + Auto routing to the model that should answer. */
export async function resolveChatModel(args: {
  baseUrl: string;
  userText: string;
  chatMode: ChatMode;
  autoModel: boolean;
  selectedModel: string;
  installed: string[];
  enabledModels: string[];
  agentModels: AgentModelRoles;
  keepAlive: string;
  signal?: AbortSignal;
  /** Prefer 1.5B explore/router for Ask and short Agent code when Hyper-Speed is on. */
  hyperSpeed?: boolean;
}): Promise<{ model: string; intent: RouteIntent; label: string }> {
  const enabled = enabledModelList(args.installed, args.enabledModels);
  const worker = resolveRoleModel("worker", args.agentModels, enabled);
  const planner = resolveRoleModel("planner", args.agentModels, enabled);
  const router = resolveRoleModel("router", args.agentModels, enabled);
  const explore = resolveRoleModel("explore", args.agentModels, enabled);
  const fastCoder = args.hyperSpeed ? explore || router : worker;

  if (!args.autoModel) {
    const manual =
      enabled.includes(args.selectedModel) ? args.selectedModel : enabled[0] ?? args.selectedModel;
    return { model: manual, intent: "code", label: manual };
  }

  if (args.chatMode === "plan") {
    return { model: planner, intent: "plan", label: `Auto → ${planner} (plan)` };
  }
  if (args.chatMode === "debug") {
    return { model: planner, intent: "debug", label: `Auto → ${planner} (debug)` };
  }
  if (args.chatMode === "ask") {
    return {
      model: fastCoder,
      intent: "ask",
      label: `Auto → ${fastCoder} (ask)`,
    };
  }
  if (args.chatMode === "multitask") {
    return { model: planner, intent: "plan", label: `Auto → ${planner} (multitask)` };
  }

  const intent = await classifyIntent({
    baseUrl: args.baseUrl,
    router,
    userText: args.userText,
    keepAlive: args.keepAlive,
    signal: args.signal,
  });

  if (intent === "plan" || intent === "debug") {
    return {
      model: planner,
      intent,
      label: `Auto → ${planner} (${intent})`,
    };
  }
  if (intent === "ask" || args.hyperSpeed) {
    // Hyper-Speed: short Agent / ask → 1.5B; long codegen still uses worker when not hyper
    const model = args.hyperSpeed || intent === "ask" ? fastCoder : worker;
    return {
      model,
      intent,
      label: `Auto → ${model} (${intent}${args.hyperSpeed ? ", hyper" : ""})`,
    };
  }
  return {
    model: worker,
    intent,
    label: `Auto → ${worker} (${intent})`,
  };
}

export async function classifyIntent(args: {
  baseUrl: string;
  router: string;
  userText: string;
  keepAlive: string;
  signal?: AbortSignal;
}): Promise<RouteIntent> {
  await warmModel(args.baseUrl, args.router, args.keepAlive);
  let raw = "";
  try {
    const result = await chatStream({
      baseUrl: args.baseUrl,
      model: args.router,
      keepAlive: args.keepAlive,
      signal: args.signal,
      options: {
        num_ctx: 1024,
        num_predict: 8,
        temperature: 0,
        top_p: 1,
      },
      messages: [
        { role: "system", content: ROUTER_SYSTEM },
        { role: "user", content: args.userText.slice(0, 1500) },
      ],
      onToken: () => {},
    });
    raw = result.text;
  } catch {
    return "code";
  }
  const word = raw.trim().toLowerCase().split(/\s+/)[0]?.replace(/[^a-z]/g, "") ?? "";
  if (word === "plan" || word === "debug" || word === "ask" || word === "code") {
    return word;
  }
  if (raw.toLowerCase().includes("plan")) return "plan";
  if (raw.toLowerCase().includes("debug")) return "debug";
  if (raw.toLowerCase().includes("ask")) return "ask";
  return "code";
}

export function systemPromptForMode(base: string, mode: ChatMode, intent: RouteIntent): string {
  if (mode === "plan" || intent === "plan") return base + PLAN_ADDENDUM;
  if (mode === "debug" || intent === "debug") return base + DEBUG_ADDENDUM;
  return base;
}

export async function planMultitask(args: {
  baseUrl: string;
  planner: string;
  userText: string;
  contextPrefix: string;
  keepAlive: string;
  options?: OllamaChatOptions;
  signal?: AbortSignal;
}): Promise<MultitaskItem[]> {
  await warmModel(args.baseUrl, args.planner, args.keepAlive);
  const userContent = args.contextPrefix
    ? `${args.contextPrefix}\n\nUser request:\n${args.userText}`
    : args.userText;
  const result = await chatStream({
    baseUrl: args.baseUrl,
    model: args.planner,
    keepAlive: args.keepAlive,
    signal: args.signal,
    options: {
      num_ctx: args.options?.num_ctx ?? 4096,
      num_predict: 1024,
      temperature: 0.2,
      top_p: 0.9,
    },
    messages: [
      { role: "system", content: MULTITASK_PLAN_SYSTEM },
      { role: "user", content: userContent },
    ],
    onToken: () => {},
  });

  return parseMultitaskJson(result.text);
}

export function parseMultitaskJson(raw: string): MultitaskItem[] {
  const cleaned = raw.replace(/```json\s*/gi, "```").replace(/```/g, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) {
    return [{ id: "1", title: "Main task", prompt: raw.trim() || "Complete the user request." }];
  }
  try {
    const arr = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    if (!Array.isArray(arr) || !arr.length) {
      return [{ id: "1", title: "Main task", prompt: "Complete the user request." }];
    }
    return arr.slice(0, 6).map((item, i) => {
      const o = item as Record<string, unknown>;
      return {
        id: String(o.id ?? i + 1),
        title: String(o.title ?? `Task ${i + 1}`),
        prompt: String(o.prompt ?? o.title ?? "Do the task"),
      };
    });
  } catch {
    return [{ id: "1", title: "Main task", prompt: cleaned.slice(0, 2000) }];
  }
}

export function withSystem(
  messages: OllamaChatMessage[],
  system: string,
): OllamaChatMessage[] {
  if (!messages.length) return [{ role: "system", content: system }];
  if (messages[0]?.role === "system") {
    return [{ role: "system", content: system }, ...messages.slice(1)];
  }
  return [{ role: "system", content: system }, ...messages];
}
