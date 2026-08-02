import { useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { useIdeStore } from "../stores/ideStore";
import ViewHeader from "./ui/ViewHeader";
import type { AgentModelRoles, PerfProfile } from "../types";
import { DEFAULT_AGENT_MODELS } from "../types";
import { PERF_PROFILES, resolvePerfConfig } from "../services/perfProfiles";
import IconButton from "./ui/IconButton";

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
  const [query, setQuery] = useState("");

  const perf = resolvePerfConfig(settings.perfProfile, {
    maxHistoryMessages: settings.maxHistoryMessages,
    maxAttachChars: settings.maxAttachChars,
    keepAlive: settings.ollamaKeepAlive,
    numGpu: settings.ollamaNumGpu,
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
    // Empty enabledModels means "all on". First disable creates explicit list.
    let next: string[];
    if (!settings.enabledModels.length) {
      next = on ? models : models.filter((m) => m !== name);
    } else {
      const set = new Set(settings.enabledModels);
      if (on) set.add(name);
      else set.delete(name);
      next = [...set];
      // If everything enabled again, store [] for "all"
      if (next.length === models.length && models.every((m) => set.has(m))) {
        next = [];
      }
    }
    updateSettings({ enabledModels: next });
    if (!on && selectedModel === name) {
      const remaining = next.length
        ? next
        : models.filter((m) => m !== name);
      if (remaining[0]) setSelectedModel(remaining[0]);
    }
  }

  function setRole(role: keyof AgentModelRoles, model: string) {
    updateSettings({
      agentModels: { ...settings.agentModels, [role]: model },
    });
  }

  const roleRows: Array<{ key: keyof AgentModelRoles; label: string; hint: string }> = [
    { key: "router", label: "Router / Explore", hint: "Ultra-fast intent classification" },
    { key: "planner", label: "Planner / Debug", hint: "Reasoning & multitask planning" },
    { key: "worker", label: "Worker / Coder", hint: "Code generation & edits" },
  ];

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
            {settings.ollamaBaseUrl}
          </span>
        </div>

        {!ollamaOnline ? (
          <div className="rounded-xl border border-pide-sidebar-border bg-pide-editor p-3 text-pide-muted text-xs leading-relaxed">
            Start Ollama, then refresh. Recommended fleet for 16GB / Iris Xe:
            <pre className="mt-2 text-pide-sidebar-fg whitespace-pre-wrap">{`ollama pull qwen2.5-coder:1.5b\nollama pull qwen2.5-coder:7b\nollama pull llama3.1:8b`}</pre>
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-pide-sidebar-border bg-pide-editor p-3 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-pide-fg">Auto</div>
                <p className="text-[11px] text-pide-muted leading-snug mt-0.5">
                  Balanced quality and speed — routes each request to a specialist model
                  (sequential; never loads two models at once).
                </p>
              </div>
              <Toggle
                on={settings.autoModel}
                onChange={(v) => updateSettings({ autoModel: v })}
              />
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
                {PERF_PROFILES[settings.perfProfile].description} · keep_alive{" "}
                {perf.keepAlive}
              </p>
            </label>

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
                    <span className="flex-1 min-w-0 truncate text-xs text-pide-fg font-mono">
                      {m}
                    </span>
                    <Toggle on={isEnabled(m)} onChange={(v) => setEnabled(m, v)} />
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-pide-sidebar-border bg-pide-editor p-3 text-pide-muted text-xs leading-relaxed space-y-1">
              <p className="text-pide-fg font-medium">Iris Xe / 16GB tips</p>
              <p>
                Auto runs models <strong className="text-pide-sidebar-fg">one at a time</strong>.
                Prefer 1.5B + 7B + 8B — skip 14B on this machine.
              </p>
              <p>
                Check <code className="text-pide-sidebar-fg">ollama ps</code> while chatting.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
