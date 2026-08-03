import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useIdeStore } from "../stores/ideStore";
import {
  resumeLlamaSidecar,
  startArgsFromSettings,
  startLlamaSidecar,
  suspendLlamaSidecar,
  waitForLlamaHealthy,
} from "../services/llamaSidecar";

/**
 * When managed + suspendOnMinimize: stop sidecar on minimize (free RAM),
 * restart on restore if still on llama.cpp backend.
 */
export function useLlamaSidecarWindowLifecycle() {
  const refreshOllama = useIdeStore((s) => s.refreshOllama);
  const pushToast = useIdeStore((s) => s.pushToast);
  const settings = useIdeStore((s) => s.settings);
  const suspendedByUs = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    let wasMinimized = false;
    let pollId = 0;

    async function restoreIfNeeded() {
      const s = settingsRef.current;
      if (!suspendedByUs.current) return;
      if (s.inferenceBackend !== "llamaCpp" || !s.llamaCppManaged) {
        suspendedByUs.current = false;
        return;
      }
      try {
        const resumed = await resumeLlamaSidecar();
        if (!resumed) {
          await startLlamaSidecar(startArgsFromSettings(s));
        }
        await waitForLlamaHealthy(45000);
        suspendedByUs.current = false;
        void refreshOllama();
      } catch (err) {
        pushToast(
          "error",
          err instanceof Error ? err.message : "Failed to resume llama-server",
        );
      }
    }

    async function pollMinimized() {
      const s = settingsRef.current;
      if (!s.llamaCppManaged || !s.llamaCppSuspendOnMinimize) return;
      try {
        const win = getCurrentWindow();
        const minimized = await win.isMinimized();
        if (minimized && !wasMinimized) {
          wasMinimized = true;
          try {
            await suspendLlamaSidecar();
            suspendedByUs.current = true;
          } catch {
            /* ignore */
          }
        } else if (!minimized && wasMinimized) {
          wasMinimized = false;
          await restoreIfNeeded();
        }
      } catch {
        /* not running under Tauri */
      }
    }

    pollId = window.setInterval(() => void pollMinimized(), 1500);
    return () => window.clearInterval(pollId);
  }, [pushToast, refreshOllama]);
}
