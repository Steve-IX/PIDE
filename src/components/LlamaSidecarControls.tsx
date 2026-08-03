import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useIdeStore } from "../stores/ideStore";
import {
  llamaSidecarStatus,
  startArgsFromSettings,
  startLlamaSidecar,
  stopLlamaSidecar,
  waitForLlamaHealthy,
  type LlamaSidecarStatus,
} from "../services/llamaSidecar";

export default function LlamaSidecarControls({ compact }: { compact?: boolean }) {
  const settings = useIdeStore((s) => s.settings);
  const updateSettings = useIdeStore((s) => s.updateSettings);
  const refreshOllama = useIdeStore((s) => s.refreshOllama);
  const pushToast = useIdeStore((s) => s.pushToast);
  const [status, setStatus] = useState<LlamaSidecarStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await llamaSidecarStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
    const id = window.setInterval(() => void refreshStatus(), 4000);
    return () => window.clearInterval(id);
  }, [refreshStatus]);

  async function pickBinary() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Executable", extensions: ["exe"] }],
    });
    if (typeof selected === "string") {
      updateSettings({ llamaCppBinaryPath: selected });
    }
  }

  async function pickGguf() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "GGUF", extensions: ["gguf"] }],
    });
    if (typeof selected === "string") {
      updateSettings({ llamaCppGgufPath: selected });
    }
  }

  async function onStart() {
    if (!settings.llamaCppBinaryPath.trim() || !settings.llamaCppGgufPath.trim()) {
      pushToast("error", "Set llama-server binary and GGUF paths first");
      return;
    }
    setBusy(true);
    try {
      const started = await startLlamaSidecar(startArgsFromSettings(settings));
      pushToast("info", `Started llama-server (PID ${started.pid}) — waiting for health…`);
      const st = await waitForLlamaHealthy(60000);
      setStatus(st);
      if (st.healthy) {
        pushToast("success", "llama-server healthy");
        updateSettings({ inferenceBackend: "llamaCpp" });
        void refreshOllama();
      } else {
        pushToast(
          "error",
          st.lastError ||
            "Sidecar started but /health not ready — check binary flags / port",
        );
      }
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      void refreshStatus();
    }
  }

  async function onStop() {
    setBusy(true);
    try {
      await stopLlamaSidecar();
      pushToast("info", "llama-server stopped");
      void refreshOllama();
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      void refreshStatus();
    }
  }

  const inputCls =
    "w-full bg-pide-input border border-pide-input-border rounded px-2 py-1.5 text-pide-input-fg text-xs font-mono";

  return (
    <div className={`space-y-2 ${compact ? "" : "pt-1"}`}>
      <div className="flex items-center gap-2">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            status?.healthy
              ? "bg-pide-git-add"
              : status?.running
                ? "bg-pide-git-mod"
                : "bg-pide-muted"
          }`}
        />
        <span className="text-xs text-pide-fg font-medium">llama-server</span>
        <span className="text-[10px] text-pide-muted ml-auto truncate">
          {status?.healthy
            ? `healthy · PID ${status.pid ?? "?"}`
            : status?.running
              ? `starting · PID ${status.pid ?? "?"}`
              : "stopped"}
        </span>
      </div>

      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={settings.llamaCppManaged}
          onChange={(e) => updateSettings({ llamaCppManaged: e.target.checked })}
        />
        <span>
          <span className="text-pide-fg">Manage llama-server</span>
          <span className="block text-[10px] text-pide-muted">
            PIDE spawns/stops the process (opt-in). Leave off for a manual terminal sidecar.
          </span>
        </span>
      </label>

      {settings.llamaCppManaged ? (
        <>
          <div className="space-y-1">
            <span className="text-[10px] text-pide-muted">Binary</span>
            <div className="flex gap-1">
              <input
                value={settings.llamaCppBinaryPath}
                onChange={(e) => updateSettings({ llamaCppBinaryPath: e.target.value })}
                placeholder="C:\…\llama-server.exe"
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => void pickBinary()}
                className="px-2 rounded bg-[var(--pide-button-secondaryBackground)] text-[var(--pide-button-secondaryForeground)] text-xs shrink-0"
              >
                …
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] text-pide-muted">GGUF model</span>
            <div className="flex gap-1">
              <input
                value={settings.llamaCppGgufPath}
                onChange={(e) => updateSettings({ llamaCppGgufPath: e.target.value })}
                placeholder="C:\…\model.gguf"
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => void pickGguf()}
                className="px-2 rounded bg-[var(--pide-button-secondaryBackground)] text-[var(--pide-button-secondaryForeground)] text-xs shrink-0"
              >
                …
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-0.5">
              <span className="text-[10px] text-pide-muted">KV cache</span>
              <select
                value={settings.llamaCppKvCache}
                onChange={(e) =>
                  updateSettings({
                    llamaCppKvCache: e.target.value as "f16" | "q8_0",
                  })
                }
                className={inputCls}
              >
                <option value="q8_0">q8_0 (half RAM)</option>
                <option value="f16">f16 (default)</option>
              </select>
            </label>
            <label className="space-y-0.5">
              <span className="text-[10px] text-pide-muted">Context (-c)</span>
              <input
                type="number"
                min={512}
                max={16384}
                value={settings.llamaCppCtx}
                onChange={(e) =>
                  updateSettings({ llamaCppCtx: Math.max(512, Number(e.target.value) || 2048) })
                }
                className={inputCls}
              />
            </label>
            <label className="space-y-0.5">
              <span className="text-[10px] text-pide-muted">GPU layers</span>
              <input
                type="number"
                min={0}
                value={settings.llamaCppNumGpu}
                onChange={(e) =>
                  updateSettings({ llamaCppNumGpu: Math.max(0, Number(e.target.value) || 0) })
                }
                className={inputCls}
              />
            </label>
            <label className="flex items-center gap-1.5 text-[10px] text-pide-muted pt-4">
              <input
                type="checkbox"
                checked={settings.llamaCppNgram}
                onChange={(e) => updateSettings({ llamaCppNgram: e.target.checked })}
              />
              ngram-mod
            </label>
          </div>

          <label className="flex items-center gap-2 text-[10px] text-pide-muted">
            <input
              type="checkbox"
              checked={settings.llamaCppSuspendOnMinimize}
              onChange={(e) =>
                updateSettings({ llamaCppSuspendOnMinimize: e.target.checked })
              }
            />
            Stop sidecar when IDE minimized (frees RAM)
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onStart()}
              className="flex-1 px-2 py-1.5 rounded-lg bg-pide-button text-pide-button-fg text-xs font-medium
                hover:bg-pide-button-hover disabled:opacity-40"
            >
              {busy ? "…" : "Start"}
            </button>
            <button
              type="button"
              disabled={busy || !status?.running}
              onClick={() => void onStop()}
              className="flex-1 px-2 py-1.5 rounded-lg bg-[var(--pide-button-secondaryBackground)]
                text-[var(--pide-button-secondaryForeground)] text-xs disabled:opacity-40"
            >
              Stop
            </button>
          </div>
        </>
      ) : null}

      <label className="flex items-start gap-2 text-xs pt-1">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={settings.ghostTextEnabled}
          onChange={(e) => updateSettings({ ghostTextEnabled: e.target.checked })}
        />
        <span>
          <span className="text-pide-fg">Ghost text (FIM)</span>
          <span className="block text-[10px] text-pide-muted">
            Inline completions via llama-server /completion. Requires Inference backend =
            llama.cpp. Tab accepts.
          </span>
        </span>
      </label>
      {settings.ghostTextEnabled ? (
        <label className="space-y-0.5 block">
          <span className="text-[10px] text-pide-muted">Ghost debounce (ms)</span>
          <input
            type="number"
            min={0}
            max={1000}
            value={settings.ghostTextDebounceMs}
            onChange={(e) =>
              updateSettings({
                ghostTextDebounceMs: Math.max(0, Math.min(1000, Number(e.target.value) || 0)),
              })
            }
            className={inputCls}
          />
        </label>
      ) : null}
    </div>
  );
}
