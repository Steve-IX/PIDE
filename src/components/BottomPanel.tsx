import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { AlertCircle, Bug, FileText, Plus, SquareTerminal, Trash2, X } from "lucide-react";
import { useIdeStore } from "../stores/ideStore";
import { getLastAppliedTheme, subscribeTheme } from "../theme";
import {
  listenPtyData,
  listenPtyExit,
  ptyCreate,
  ptyKill,
  ptyResize,
  ptyWrite,
} from "../services/pty";
import { DebugPanelBody } from "./DebugToolbar";

const MAX_SESSIONS = 4;

type SessionUi = {
  id: string;
  title: string;
  term: XTerm;
  fit: FitAddon;
  el: HTMLDivElement;
  disposeData: { dispose: () => void };
};

const PANEL_TABS = [
  { id: "terminal" as const, label: "Terminal", icon: SquareTerminal },
  { id: "output" as const, label: "Output", icon: FileText },
  { id: "problems" as const, label: "Problems", icon: AlertCircle },
  { id: "debug" as const, label: "Debug", icon: Bug },
];

export default function BottomPanel() {
  const open = useIdeStore((s) => s.bottomPanelOpen);
  const tab = useIdeStore((s) => s.bottomPanelTab);
  const setBottomPanelTab = useIdeStore((s) => s.setBottomPanelTab);
  const setBottomPanelOpen = useIdeStore((s) => s.setBottomPanelOpen);
  const height = useIdeStore((s) => s.settings.bottomPanelHeight);
  const updateSettings = useIdeStore((s) => s.updateSettings);
  const workspacePath = useIdeStore((s) => s.workspacePath);
  const outputLines = useIdeStore((s) => s.outputLines);
  const problems = useIdeStore((s) => s.problems);
  const clearProblems = useIdeStore((s) => s.clearProblems);
  const openFileAt = useIdeStore((s) => s.openFileAt);
  const ptySessions = useIdeStore((s) => s.ptySessions);
  const activePtyId = useIdeStore((s) => s.activePtyId);
  const pendingPtySessionTitle = useIdeStore((s) => s.pendingPtySessionTitle);
  const registerPtySession = useIdeStore((s) => s.registerPtySession);
  const unregisterPtySession = useIdeStore((s) => s.unregisterPtySession);
  const focusPtySession = useIdeStore((s) => s.focusPtySession);
  const requestPtySession = useIdeStore((s) => s.requestPtySession);
  const clearPendingPtySession = useIdeStore((s) => s.clearPendingPtySession);
  const pushToast = useIdeStore((s) => s.pushToast);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const sessionsRef = useRef<Map<string, SessionUi>>(new Map());
  const cwdRef = useRef("");
  const unlistenDataRef = useRef<(() => void) | undefined>(undefined);
  const unlistenExitRef = useRef<(() => void) | undefined>(undefined);
  const spawningRef = useRef(false);

  useEffect(() => {
    cwdRef.current = workspacePath || "";
  }, [workspacePath]);

  useEffect(() => {
    return subscribeTheme((applied) => {
      for (const s of sessionsRef.current.values()) {
        if (s.term.options) s.term.options.theme = applied.xterm;
      }
    });
  }, []);

  async function spawnSession(title: string): Promise<string | null> {
    const host = hostRef.current;
    if (!host) return null;
    if (sessionsRef.current.size >= MAX_SESSIONS) {
      pushToast("error", `Max ${MAX_SESSIONS} terminal sessions`);
      return null;
    }
    if (spawningRef.current) return null;
    spawningRef.current = true;

    const el = document.createElement("div");
    el.className = "pide-term-viewport absolute inset-0";
    el.style.display = "none";
    host.appendChild(el);

    const xt = getLastAppliedTheme()?.xterm;
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: "bar",
      cursorWidth: 2,
      fontSize: 13,
      lineHeight: 1.35,
      letterSpacing: 0.3,
      fontFamily:
        '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace',
      theme: xt ?? {
        background: "#0a0e14",
        foreground: "#e6edf7",
        cursor: "#5b9cff",
        cursorAccent: "#0a0e14",
        selectionBackground: "#3d7eff55",
        black: "#0a0e14",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#fbbf24",
        blue: "#5b9cff",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e6edf7",
        brightBlack: "#6b7588",
        brightRed: "#fca5a5",
        brightGreen: "#86efac",
        brightYellow: "#fde68a",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#ffffff",
      },
      // PTY owns echo — never convert in a way that doubles CR locally
      convertEol: false,
      scrollback: 8000,
      allowProposedApi: true,
      windowsPty: { backend: "conpty", buildNumber: 22621 },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    const cwd = cwdRef.current || ".";

    try {
      const id = await ptyCreate(cwd === "." ? "" : cwd, term.cols || 80, term.rows || 24);

      // Input → PTY only (shell echoes back). Never term.write() here.
      const disposeData = term.onData((data) => {
        if (useIdeStore.getState().activePtyId !== id) return;
        void ptyWrite(id, data).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          term.write(`\r\n\x1b[31m${msg}\x1b[0m\r\n`);
        });
      });

      // Copy/paste: Ctrl+C copies when there is a selection; otherwise → PTY (SIGINT).
      // Ctrl+V / Shift+Insert paste from system clipboard into the PTY.
      term.attachCustomKeyEventHandler((ev) => {
        if (ev.type !== "keydown") return true;
        const key = ev.key.toLowerCase();
        if ((ev.ctrlKey || ev.metaKey) && key === "c") {
          const sel = term.getSelection();
          if (sel) {
            void import("../services/clipboard").then(({ clipboardWrite }) =>
              clipboardWrite(sel),
            );
            return false;
          }
          return true;
        }
        if (
          ((ev.ctrlKey || ev.metaKey) && key === "v") ||
          (ev.shiftKey && ev.key === "Insert")
        ) {
          void import("../services/clipboard")
            .then(({ clipboardRead }) => clipboardRead())
            .then((text) => {
              if (!text) return;
              const normalized = text.replace(/\r?\n/g, "\r");
              return ptyWrite(id, normalized);
            })
            .catch(() => undefined);
          return false;
        }
        return true;
      });

      const ui: SessionUi = { id, title, term, fit, el, disposeData };
      sessionsRef.current.set(id, ui);
      registerPtySession(id, title);

      const pending = useIdeStore.getState().pendingPtyWrite;
      if (pending && useIdeStore.getState().activePtyId === id) {
        useIdeStore.setState({ pendingPtyWrite: null });
        window.setTimeout(() => void ptyWrite(id, pending), 400);
      }

      showSession(id);
      return id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      term.write(`\x1b[31mFailed to start PTY: ${msg}\x1b[0m\r\n`);
      pushToast("error", `Terminal: ${msg}`);
      term.dispose();
      el.remove();
      return null;
    } finally {
      spawningRef.current = false;
    }
  }

  function showSession(id: string) {
    for (const [sid, s] of sessionsRef.current) {
      s.el.style.display = sid === id ? "block" : "none";
    }
    focusPtySession(id);
    const s = sessionsRef.current.get(id);
    if (s) {
      requestAnimationFrame(() => {
        s.fit.fit();
        void ptyResize(id, s.term.cols, s.term.rows);
        s.term.focus();
      });
    }
  }

  async function killSession(id: string) {
    const s = sessionsRef.current.get(id);
    if (!s) return;
    sessionsRef.current.delete(id);
    s.disposeData.dispose();
    s.term.dispose();
    s.el.remove();
    unregisterPtySession(id);
    try {
      await ptyKill(id);
    } catch {
      /* already gone */
    }
    const next = [...sessionsRef.current.keys()].pop();
    if (next) showSession(next);
  }

  async function killAllSessions() {
    const ids = [...sessionsRef.current.keys()];
    for (const id of ids) await killSession(id);
  }

  // Panel open: exactly one data/exit listener for the panel lifetime
  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const unData = await listenPtyData((payload) => {
        const s = sessionsRef.current.get(payload.id);
        if (s) s.term.write(payload.data);
        useIdeStore.getState().appendPtyOutputForDiagnostics(payload.data);
      });
      const unExit = await listenPtyExit((payload) => {
        const s = sessionsRef.current.get(payload.id);
        if (s) {
          s.term.write("\r\n\x1b[33m[shell exited]\x1b[0m\r\n");
          void killSession(payload.id);
        }
      });

      // Strict Mode / fast remount: drop the listener we just attached
      if (cancelled) {
        unData();
        unExit();
        return;
      }

      unlistenDataRef.current?.();
      unlistenExitRef.current?.();
      unlistenDataRef.current = unData;
      unlistenExitRef.current = unExit;

      if (sessionsRef.current.size === 0 && !spawningRef.current) {
        await spawnSession("Shell");
      }
    })();

    return () => {
      cancelled = true;
      unlistenDataRef.current?.();
      unlistenExitRef.current?.();
      unlistenDataRef.current = undefined;
      unlistenExitRef.current = undefined;
      // Tear down sessions so Strict Mode remount cannot leave orphan PTYs + duplicate shells
      const ids = [...sessionsRef.current.keys()];
      for (const id of ids) void killSession(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- panel open lifecycle only
  }, [open]);

  // Panel closed: ensure no leftover listeners/sessions
  useEffect(() => {
    if (open) return;
    unlistenDataRef.current?.();
    unlistenExitRef.current?.();
    unlistenDataRef.current = undefined;
    unlistenExitRef.current = undefined;
    void killAllSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !pendingPtySessionTitle) return;
    const title = pendingPtySessionTitle;
    const existing = [...sessionsRef.current.values()].find((s) => s.title === title);
    if (existing) {
      clearPendingPtySession();
      showSession(existing.id);
      return;
    }
    clearPendingPtySession();
    void spawnSession(title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingPtySessionTitle]);

  useEffect(() => {
    if (!open || !activePtyId) return;
    if (sessionsRef.current.has(activePtyId)) showSession(activePtyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePtyId, open]);

  useEffect(() => {
    if (!open || tab !== "terminal" || !activePtyId) return;
    const s = sessionsRef.current.get(activePtyId);
    if (s) {
      s.fit.fit();
      void ptyResize(activePtyId, s.term.cols, s.term.rows);
    }
  }, [open, tab, height, activePtyId]);

  if (!open) return null;

  const cwdLabel = workspacePath
    ? workspacePath.split(/[/\\]/).filter(Boolean).slice(-2).join("/")
    : "no workspace";

  return (
    <div className="pide-bottom-panel flex flex-col shrink-0" style={{ height }}>
      <div
        className="pide-bottom-resize"
        onPointerDown={(e) => {
          e.preventDefault();
          const startY = e.clientY;
          const startH = height;
          const move = (ev: PointerEvent) => {
            const next = Math.min(520, Math.max(140, startH + (startY - ev.clientY)));
            updateSettings({ bottomPanelHeight: next });
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      />

      <div className="pide-bottom-tabs">
        <div className="flex items-center gap-0.5 min-w-0 flex-1">
          {PANEL_TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setBottomPanelTab(id)}
                className={`pide-bottom-tab ${active ? "pide-bottom-tab-active" : ""}`}
              >
                <Icon size={12} strokeWidth={active ? 2.25 : 1.75} className="opacity-80" />
                <span>{label}</span>
                {id === "problems" && problems.length > 0 ? (
                  <span className="pide-bottom-badge">{problems.length}</span>
                ) : null}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="pide-bottom-icon-btn"
          onClick={() => setBottomPanelOpen(false)}
          title="Close panel"
        >
          <X size={14} />
        </button>
      </div>

      {tab === "terminal" ? (
        <div className="pide-term-session-bar">
          <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto">
            {ptySessions.map((s) => {
              const active = s.id === activePtyId;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => showSession(s.id)}
                  className={`pide-term-session ${active ? "pide-term-session-active" : ""}`}
                  title={s.title}
                >
                  <span className={`pide-term-session-dot ${active ? "is-live" : ""}`} />
                  <span className="truncate">{s.title}</span>
                </button>
              );
            })}
            <button
              type="button"
              className="pide-bottom-icon-btn shrink-0"
              title="New terminal"
              onClick={() => {
                const n = ptySessions.filter((p) => p.title.startsWith("Shell")).length + 1;
                requestPtySession(n <= 1 ? "Shell" : `Shell ${n}`);
              }}
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="flex items-center gap-2 shrink-0 pl-2">
            <span className="pide-term-cwd" title={workspacePath || undefined}>
              {cwdLabel}
            </span>
            {activePtyId ? (
              <button
                type="button"
                className="pide-bottom-icon-btn pide-bottom-icon-btn-danger"
                title="Kill session"
                onClick={() => void killSession(activePtyId)}
              >
                <Trash2 size={13} />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        ref={hostRef}
        className={`pide-term-host relative min-h-0 ${tab === "terminal" ? "flex-1" : "hidden"}`}
      />

      {tab === "problems" ? (
        <div className="flex-1 min-h-0 overflow-auto pide-bottom-body">
          <div className="px-3 py-1.5 flex justify-end">
            <button
              type="button"
              className="text-[11px] text-pide-muted hover:text-pide-fg transition-colors"
              onClick={clearProblems}
            >
              Clear
            </button>
          </div>
          {!problems.length && (
            <p className="px-3 py-2 text-xs text-pide-muted">No problems reported.</p>
          )}
          {problems.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-3 py-1.5 text-xs border-b border-pide-sidebar-border/40 hover:bg-pide-list-hover transition-colors duration-150"
              onClick={() => {
                if (p.path && p.line) void openFileAt(p.path, p.line, p.column ?? 1);
              }}
            >
              <span
                className={
                  p.severity === "error"
                    ? "text-pide-error"
                    : p.severity === "warning"
                      ? "text-pide-git-mod"
                      : "text-pide-muted"
                }
              >
                [{p.source}]
              </span>{" "}
              <span className="text-pide-fg">{p.message}</span>
              {p.path && (
                <span className="text-pide-muted">
                  {" "}
                  — {p.path}
                  {p.line ? `:${p.line}` : ""}
                  {p.column ? `:${p.column}` : ""}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : null}

      {tab === "output" ? (
        <div className="flex-1 min-h-0 overflow-auto p-3 font-mono text-[12px] leading-relaxed text-pide-muted whitespace-pre-wrap pide-bottom-body">
          {outputLines.length ? outputLines.join("\n") : "No output yet."}
        </div>
      ) : null}

      {tab === "debug" ? (
        <div className="flex-1 min-h-0 overflow-hidden pide-bottom-body">
          <DebugPanelBody />
        </div>
      ) : null}
    </div>
  );
}
