import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useIdeStore } from "../stores/ideStore";
import { runShellCommand } from "../services/fs";
import { getLastAppliedTheme, subscribeTheme } from "../theme";

export default function BottomPanel() {
  const open = useIdeStore((s) => s.bottomPanelOpen);
  const tab = useIdeStore((s) => s.bottomPanelTab);
  const setBottomPanelTab = useIdeStore((s) => s.setBottomPanelTab);
  const setBottomPanelOpen = useIdeStore((s) => s.setBottomPanelOpen);
  const height = useIdeStore((s) => s.settings.bottomPanelHeight);
  const updateSettings = useIdeStore((s) => s.updateSettings);
  const workspacePath = useIdeStore((s) => s.workspacePath);
  const outputLines = useIdeStore((s) => s.outputLines);
  const appendOutput = useIdeStore((s) => s.appendOutput);
  const problems = useIdeStore((s) => s.problems);
  const clearProblems = useIdeStore((s) => s.clearProblems);
  const openFileAt = useIdeStore((s) => s.openFileAt);

  const termRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const lineBuf = useRef("");
  const cwdRef = useRef("");

  useEffect(() => {
    cwdRef.current = workspacePath || "";
  }, [workspacePath]);

  useEffect(() => {
    return subscribeTheme((applied) => {
      xtermRef.current?.options && (xtermRef.current.options.theme = applied.xterm);
    });
  }, []);

  useEffect(() => {
    if (!open || tab !== "terminal") return;
    const el = termRef.current;
    if (!el) return;

    const xt = getLastAppliedTheme()?.xterm;
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Consolas, "Cascadia Code", monospace',
      theme: xt ?? {
        background: "#0d1118",
        foreground: "#d7dde8",
        cursor: "#3d7eff",
      },
      convertEol: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    xtermRef.current = term;
    fitRef.current = fit;

    const cwd = cwdRef.current || ".";
    term.writeln("\x1b[36mPIDE Terminal\x1b[0m — type a PowerShell command, Enter to run");
    term.writeln(`cwd: ${cwd}`);
    term.write("\r\n> ");

    const disposable = term.onData((data) => {
      if (data === "\r") {
        const cmd = lineBuf.current;
        term.write("\r\n");
        lineBuf.current = "";
        if (!cmd.trim()) {
          term.write("> ");
          return;
        }
        if (cmd.trim() === "clear" || cmd.trim() === "cls") {
          term.clear();
          term.write("> ");
          return;
        }
        const runCwd = cwdRef.current || ".";
        appendOutput(`$ ${cmd}`);
        void runShellCommand(runCwd, cmd)
          .then((res) => {
            if (res.stdout) {
              term.write(res.stdout.replace(/\n/g, "\r\n"));
              if (!res.stdout.endsWith("\n")) term.write("\r\n");
              appendOutput(res.stdout);
            }
            if (res.stderr) {
              term.write(`\x1b[31m${res.stderr.replace(/\n/g, "\r\n")}\x1b[0m`);
              if (!res.stderr.endsWith("\n")) term.write("\r\n");
              appendOutput(res.stderr);
            }
            if (res.code !== 0) {
              term.writeln(`\x1b[33m[exit ${res.code}]\x1b[0m`);
            }
            term.write("> ");
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            term.writeln(`\x1b[31m${msg}\x1b[0m`);
            appendOutput(msg);
            term.write("> ");
          });
        return;
      }
      if (data === "\u007f") {
        if (lineBuf.current.length > 0) {
          lineBuf.current = lineBuf.current.slice(0, -1);
          term.write("\b \b");
        }
        return;
      }
      if (data === "\u0003") {
        lineBuf.current = "";
        term.write("^C\r\n> ");
        return;
      }
      if (data >= " " || data === "\t") {
        lineBuf.current += data;
        term.write(data);
      }
    });

    const onResize = () => fit.fit();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      disposable.dispose();
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
      lineBuf.current = "";
    };
  }, [open, tab, appendOutput]);

  useEffect(() => {
    if (open && tab === "terminal") {
      fitRef.current?.fit();
    }
  }, [open, tab, height]);

  if (!open) return null;

  return (
    <div
      className="flex flex-col border-t border-pide-panel-border bg-pide-panel"
      style={{ height }}
    >
      <div
        className="h-1 cursor-row-resize bg-pide-panel-border hover:bg-pide-focus transition-colors duration-150"
        onPointerDown={(e) => {
          e.preventDefault();
          const startY = e.clientY;
          const startH = height;
          const move = (ev: PointerEvent) => {
            const next = Math.min(480, Math.max(120, startH + (startY - ev.clientY)));
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
      <div className="h-8 flex items-center px-2 gap-1 border-b border-pide-panel-border shrink-0">
        {(["terminal", "output", "problems"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setBottomPanelTab(t)}
            className={`px-2 py-0.5 text-xs rounded capitalize transition-colors duration-150 ${
              tab === t
                ? "bg-pide-list-active text-[var(--pide-panelTitle-activeForeground)]"
                : "text-[var(--pide-panelTitle-inactiveForeground)] hover:text-[var(--pide-panelTitle-activeForeground)]"
            }`}
          >
            {t}
            {t === "problems" && problems.length ? ` (${problems.length})` : ""}
          </button>
        ))}
        <button
          type="button"
          className="ml-auto text-pide-muted hover:text-pide-fg px-2 text-sm transition-colors duration-150"
          onClick={() => setBottomPanelOpen(false)}
          title="Close panel"
        >
          ×
        </button>
      </div>
      {tab === "terminal" ? (
        <div ref={termRef} className="flex-1 min-h-0 px-1 py-1" />
      ) : tab === "problems" ? (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="px-2 py-1 flex justify-end">
            <button
              type="button"
              className="text-[11px] text-pide-muted hover:text-pide-fg"
              onClick={clearProblems}
            >
              Clear
            </button>
          </div>
          {!problems.length && (
            <p className="p-2 text-xs text-pide-muted">No problems reported.</p>
          )}
          {problems.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-2 py-1.5 text-xs border-b border-pide-sidebar-border hover:bg-pide-list-hover transition-colors duration-150"
              onClick={() => {
                if (p.path && p.line) void openFileAt(p.path, p.line);
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
                </span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto p-2 font-mono text-xs text-pide-muted whitespace-pre-wrap">
          {outputLines.length ? outputLines.join("\n") : "No output yet."}
        </div>
      )}
    </div>
  );
}
