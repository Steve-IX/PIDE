import { useMemo, useState } from "react";
import { Gauge, RefreshCw, Search } from "lucide-react";
import { useIdeStore } from "../stores/ideStore";
import ViewHeader from "./ui/ViewHeader";
import type { AgentModelRoles, InferenceBackend, PerfProfile } from "../types";
import { DEFAULT_AGENT_MODELS } from "../types";
import { PERF_PROFILES, resolvePerfConfig } from "../services/perfProfiles";
import { SPEED_LAB_PROMPT, SYSTEM_PROMPT } from "../services/ollama";
import { unifiedChatStream, warmInferenceModel } from "../services/llmChat";
import IconButton from "./ui/IconButton";
import LlamaSidecarControls from "./LlamaSidecarControls";

function Toggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative w-10 h-5 rounded-full shrink-0 transition-colors duration-150 ${
        on ? "bg-pide-git-add" : "bg-pide-list-hover border border-pide-input-border"
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-150 ${
          on ? "left-5" : "left-0.5"
        }`}
      />
    </button>
  );
}

export default function OllamaStatus() {
  const ollamaOnline = useIdeStore((s) => s.ollamaOnline);
  const models = useIdeStore((s) => s.models);
  const selectedModel = useIdeStore((s) => s.selectedModel);
  const setSelectedModel = useIdeStore((s) => s.setSelectedModel);
  const refreshOllama = useIdeStore((s) => s.refreshOllama);
  const settings = useIdeStore((s) => s.settings);
  const updateSettings = useIdeStore((s) => s.updateSettings);
  const setLastTokensPerSec = useIdeStore((s) => s.setLastTokensPerSec);
  const lastTokensPerSec = useIdeStore((s) => s.lastTokensPerSec);
  const pushToast = useIdeStore((s) => s.pushToast);
  const [query, setQuery] = useState("");
  const [labRunning, setLabRunning] = useState(false);
  const [labResult, setLabResult] = useState<{
    tokensPerSec: number;
    evalCount: number;
    model: string;
  } | null>(null);

  const perf = resolvePerfConfig(settings.perfProfile, {
    maxHistoryMessages: settings.maxHistoryMessages,
    maxAttachChars: settings.maxAttachChars,
    keepAlive: settings.ollamaKeepAlive,
    numGpu: settings.ollamaNumGpu,
    hyperSpeed: settings.hyperSpeed,
  });

  const enabledSet = useMemo(() => {
    if (!settings.enabledModels.length) return null;
    return new Set(settings.enabledModels);
  }, [settings.enabledModels]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter((m) => !q || m.toLowerCase().includes(q));
  }, [models, query]);

  function isEnabled(name: string): boolean {
    if (!enabledSet) return true;
    return enabledSet.has(name);
  }

  function setEnabled(name: string, on: boolean) {
    let next: string[];
    if (!settings.enabledModels.length) {
      next = on ? models : models.filter((m) => m !== name);
    } else {
      const set = new Set(settings.enabledModels);
      if (on) set.add(name);
      else set.delete(name);
      next = [...set];
      if (next.length === models.length && models.every((m) => set.has(m))) {
        next = [];
      }
    }
    updateSettings({ enabledModels: next });
    if (!on && selectedModel === name) {
      const remaining = next.length ? next : models.filter((m) => m !== name);
      if (remaining[0]) setSelectedModel(remaining[0]);
    }
  }

  function setRole(role: keyof AgentModelRoles, model: string) {
    updateSettings({
      agentModels: { ...settings.agentModels, [role]: model },
    });
  }

  async function runSpeedLab() {
    if (!selectedModel || labRunning) return;
    setLabRunning(true);
    setLabResult(null);
    try {
      const backend = settings.inferenceBackend ?? "ollama";
      await warmInferenceModel({
        backend,
        ollamaBaseUrl: settings.ollamaBaseUrl,
        model: selectedModel,
        keepAlive: perf.keepAlive,
      });
      const result = await unifiedChatStream({
        backend,
        ollamaBaseUrl: settings.ollamaBaseUrl,
        llamaCppBaseUrl: settings.llamaCppBaseUrl,
        model: selectedModel,
        keepAlive: perf.keepAlive,
        options: {
          ...perf.options,
          num_predict: Math.min(perf.options.num_predict, 512),
        },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: SPEED_LAB_PROMPT },
        ],
        onToken: () => {},
      });
      if (!result.metrics) {
        pushToast("error", "No eval metrics returned — try again or check backend");
        return;
      }
      const row = {
        tokensPerSec: result.metrics.tokensPerSec,
        evalCount: result.metrics.evalCount,
        model: selectedModel,
      };
      setLabResult(row);
      setLastTokensPerSec(row.tokensPerSec);
      const hit = row.tokensPerSec >= 40;
      pushToast(
        hit ? "success" : "info",
        `${row.tokensPerSec.toFixed(1)} tok/s on ${selectedModel}${
          hit ? " (target band)" : " (below 40 tok/s)"
        }`,
      );
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setLabRunning(false);
    }
  }

  const roleRows: Array<{ key: keyof AgentModelRoles; label: string; hint: string }> = [
    { key: "router", label: "Router / Explore", hint: "Ultra-fast intent classification" },
    { key: "planner", label: "Planner / Debug", hint: "Reasoning & multitask planning" },
    { key: "worker", label: "Worker / Coder", hint: "Code generation & edits" },
  ];

  const labBand =
    labResult && labResult.tokensPerSec >= 40 && labResult.tokensPerSec <= 70
      ? "in"
      : labResult && labResult.tokensPerSec > 70
        ? "above"
        : labResult
          ? "below"
          : null;

  return (
    <div className="h-full flex flex-col bg-pide-sidebar">
      <ViewHeader
        title="Models"
        actions={
          <IconButton title="Refresh" onClick={() => void refreshOllama()}>
            <RefreshCw size={14} />
          </IconButton>
        }
      />

      <div className="p-3 space-y-4 text-sm overflow-auto">
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              ollamaOnline ? "bg-pide-git-add" : "bg-pide-git-del"
            }`}
          />
          <span className="text-pide-fg">
            {ollamaOnline ? "Connected" : "Offline"}
          </span>
          <span className="text-pide-muted text-xs ml-auto truncate" title={settings.ollamaBaseUrl}>
            {settings.inferenceBackend === "llamaCpp"
              ? settings.llamaCppBaseUrl
              : settings.ollamaBaseUrl}
          </span>
        </div>

        {!ollamaOnline ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-pide-sidebar-border bg-pide-editor p-3 text-pide-muted text-xs leading-relaxed">
              {settings.inferenceBackend === "llamaCpp" ? (
                <>
                  Start <strong className="text-pide-sidebar-fg">llama-server</strong> on{" "}
                  <code className="text-pide-sidebar-fg">{settings.llamaCppBaseUrl}</code>, then
                  refresh. Ghost text / chat need{" "}
                  <code className="text-pide-sidebar-fg">/health</code> green.
                  <pre className="mt-2 text-pide-sidebar-fg whitespace-pre-wrap text-[10px]">{`# Example (manual):
llama-server -m qwen2.5-coder-1.5b.gguf -ngl 99 -c 2048 -fa on \\
  --host 127.0.0.1 --port 8080 --cache-type-k q8_0 --cache-type-v q8_0`}</pre>
                  <p className="mt-2">
                    Or enable <strong className="text-pide-sidebar-fg">Manage llama-server</strong>{" "}
                    below and click Start.
                  </p>
                </>
              ) : (
                <>
                  Start Ollama, then refresh. Recommended fleet for 16GB / Iris Xe:
                  <pre className="mt-2 text-pide-sidebar-fg whitespace-pre-wrap">{`ollama pull qwen2.5-coder:1.5b\nollama pull qwen2.5-coder:7b\nollama pull llama3.1:8b`}</pre>
                </>
              )}
            </div>

            <label className="block space-y-1">
              <span className="text-xs text-pide-muted uppercase tracking-wide">
                Inference backend
              </span>
              <select
                value={settings.inferenceBackend}
                onChange={(e) => {
                  updateSettings({
                    inferenceBackend: e.target.value as InferenceBackend,
                  });
                  void refreshOllama();
                }}
                className="w-full bg-pide-input border border-pide-input-border rounded-lg px-2 py-1.5 text-pide-input-fg text-sm"
              >
                <option value="ollama">Ollama</option>
                <option value="llamaCpp">llama.cpp (ngram)</option>
              </select>
            </label>

            <div className="rounded-xl border border-pide-sidebar-border bg-pide-editor p-3">
              <LlamaSidecarControls compact />
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-pide-sidebar-border bg-pide-editor p-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-pide-fg">Auto</div>
                <p className="text-[11px] text-pide-muted leading-snug mt-0.5">
                  Routes each request to a specialist (sequential; never two models at once).
                </p>
              </div>
              <Toggle
                on={settings.autoModel}
                onChange={(v) => updateSettings({ autoModel: v })}
              />
            </div>

            <div className="rounded-xl border border-pide-sidebar-border bg-pide-editor p-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-pide-fg">Hyper-Speed</div>
                <p className="text-[11px] text-pide-muted leading-snug mt-0.5">
                  Tight ctx, high GPU offload, prefer 1.5B — aim for 40–70 tok/s on Iris Xe.
                </p>
              </div>
              <Toggle
                on={settings.hyperSpeed}
                onChange={(v) => updateSettings({ hyperSpeed: v })}
              />
            </div>

            <div className="rounded-xl border border-pide-sidebar-border bg-pide-editor p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Gauge size={14} className="text-pide-link shrink-0" />
                <span className="text-sm font-semibold text-pide-fg">Speed Lab</span>
              </div>
              <p className="text-[11px] text-pide-muted leading-snug">
                Warm + run a fixed coding prompt on the selected model. Measures real{" "}
                <code className="text-pide-sidebar-fg">eval_count / eval_duration</code>.
              </p>
              <button
                type="button"
                disabled={!selectedModel || labRunning}
                onClick={() => void runSpeedLab()}
                className="w-full px-3 py-2 rounded-lg bg-pide-button hover:bg-pide-button-hover text-pide-button-fg
                  text-xs font-medium disabled:opacity-40 transition-colors duration-150"
              >
                {labRunning ? "Benchmarking…" : `Benchmark ${selectedModel || "model"}`}
              </button>
              {labResult ? (
                <div
                  className={`text-xs rounded-lg px-2.5 py-2 border ${
                    labBand === "in"
                      ? "border-pide-git-add/40 text-pide-git-add bg-pide-git-add/10"
                      : labBand === "above"
                        ? "border-pide-link/40 text-pide-link bg-pide-link/10"
                        : "border-pide-widget-border text-pide-muted"
                  }`}
                >
                  <span className="font-semibold text-pide-fg">
                    {labResult.tokensPerSec.toFixed(1)} tok/s
                  </span>
                  {" · "}
                  {labResult.evalCount} tokens · {labResult.model}
                  {labBand === "in"
                    ? " · in 40–70 target"
                    : labBand === "above"
                      ? " · above target"
                      : " · below 40 tok/s"}
                </div>
              ) : lastTokensPerSec != null ? (
                <p className="text-[11px] text-pide-muted">
                  Last chat: {lastTokensPerSec.toFixed(1)} tok/s
                </p>
              ) : null}
            </div>

            <label className="block space-y-1">
              <span className="text-xs text-pide-muted uppercase tracking-wide">
                Speed profile
              </span>
              <select
                value={settings.perfProfile}
                onChange={(e) =>
                  updateSettings({ perfProfile: e.target.value as PerfProfile })
                }
                className="w-full bg-pide-input border border-pide-input-border rounded-lg px-2 py-1.5 text-pide-input-fg text-sm"
              >
                {(Object.keys(PERF_PROFILES) as PerfProfile[]).map((id) => (
                  <option key={id} value={id}>
                    {PERF_PROFILES[id].label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-pide-muted">
                {settings.hyperSpeed
                  ? "Hyper-Speed overrides profile for max throughput"
                  : PERF_PROFILES[settings.perfProfile].description}{" "}
                · keep_alive {perf.keepAlive}
                {perf.options.num_gpu != null ? ` · num_gpu ${perf.options.num_gpu}` : ""}
              </p>
            </label>

            <label className="block space-y-1">
              <span className="text-xs text-pide-muted uppercase tracking-wide">
                Inference backend
              </span>
              <select
                value={settings.inferenceBackend}
                onChange={(e) => {
                  updateSettings({
                    inferenceBackend: e.target.value as InferenceBackend,
                  });
                  void refreshOllama();
                }}
                className="w-full bg-pide-input border border-pide-input-border rounded-lg px-2 py-1.5 text-pide-input-fg text-sm"
              >
                <option value="ollama">Ollama</option>
                <option value="llamaCpp">llama.cpp (ngram)</option>
              </select>
            </label>

            <div className="rounded-xl border border-pide-sidebar-border bg-pide-editor p-3">
              <LlamaSidecarControls compact />
            </div>

            <div className="space-y-2">
              <span className="text-xs text-pide-muted uppercase tracking-wide">
                Task models
              </span>
              {roleRows.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center gap-2 py-1.5 border-b border-pide-sidebar-border/60"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-pide-fg font-medium">{row.label}</div>
                    <div className="text-[10px] text-pide-muted">{row.hint}</div>
                  </div>
                  <select
                    value={
                      models.includes(settings.agentModels[row.key])
                        ? settings.agentModels[row.key]
                        : settings.agentModels[row.key] || DEFAULT_AGENT_MODELS[row.key]
                    }
                    onChange={(e) => setRole(row.key, e.target.value)}
                    className="max-w-[9.5rem] bg-pide-input border border-pide-input-border rounded-full px-2 py-1 text-[11px] text-pide-input-fg"
                  >
                    {!models.includes(settings.agentModels[row.key]) && (
                      <option value={settings.agentModels[row.key]}>
                        {settings.agentModels[row.key]} (missing)
                      </option>
                    )}
                    {models.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <span className="text-xs text-pide-muted uppercase tracking-wide">
                Installed ({models.length})
              </span>
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-pide-input border border-pide-input-border">
                <Search size={13} className="text-pide-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Add or search model"
                  className="flex-1 min-w-0 bg-transparent text-xs text-pide-input-fg outline-none"
                />
              </div>
              <ul className="space-y-0.5">
                {filtered.map((m) => (
                  <li
                    key={m}
                    className="flex items-center gap-2 py-2 px-1 border-b border-pide-sidebar-border/40"
                  >
                    <button
                      type="button"
                      className={`flex-1 min-w-0 truncate text-xs font-mono text-left ${
                        m === selectedModel ? "text-pide-link" : "text-pide-fg"
                      }`}
                      onClick={() => setSelectedModel(m)}
                      title="Select for Speed Lab / manual pin"
                    >
                      {m}
                    </button>
                    <Toggle on={isEnabled(m)} onChange={(v) => setEnabled(m, v)} />
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-pide-sidebar-border bg-pide-editor p-3 text-pide-muted text-xs leading-relaxed space-y-1">
              <p className="text-pide-fg font-medium">Iris Xe / 16GB tips</p>
              <p>
                Never load two LLMs at once. Prefer{" "}
                <strong className="text-pide-sidebar-fg">1.5B</strong> for chatty Hyper-Speed
                loops; reserve 7B/8B for Plan/Debug.
              </p>
              <p>
                If <code className="text-pide-sidebar-fg">ollama ps</code> shows{" "}
                <strong className="text-pide-sidebar-fg">100% CPU</strong>, enable Vulkan for the
                iGPU (user env, then restart Ollama):
              </p>
              <pre className="text-pide-sidebar-fg whitespace-pre-wrap text-[10px] leading-snug">{`OLLAMA_VULKAN=1
GGML_VK_DISABLE_INTEGER_DOT_PRODUCT=1`}</pre>
              <p>
                Then re-run Speed Lab. Without GPU offload, 40 tok/s is unlikely on Iris Xe.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
