import { Play, ArrowDownToLine, ArrowUpFromLine, Square, SkipForward } from "lucide-react";
import { useIdeStore } from "../stores/ideStore";

export default function DebugToolbar() {
  const debugState = useIdeStore((s) => s.debugState);
  const debugStopReason = useIdeStore((s) => s.debugStopReason);
  const startDebugging = useIdeStore((s) => s.startDebugging);
  const stopDebugging = useIdeStore((s) => s.stopDebugging);
  const debugContinue = useIdeStore((s) => s.debugContinue);
  const debugStepOver = useIdeStore((s) => s.debugStepOver);
  const debugStepIn = useIdeStore((s) => s.debugStepIn);
  const debugStepOut = useIdeStore((s) => s.debugStepOut);

  const active = debugState !== "idle";
  const stopped = debugState === "stopped";

  const btn =
    "p-1 rounded hover:bg-pide-list-hover text-pide-fg disabled:opacity-30 transition-colors duration-150";

  return (
    <div className="border-b border-pide-sidebar-border bg-pide-editor px-2 py-1 flex items-center gap-1 shrink-0">
      <button
        type="button"
        className={btn}
        title="Start Debugging (F5)"
        disabled={active}
        onClick={() => void startDebugging()}
      >
        <Play size={14} className="text-pide-git-add" />
      </button>
      <button
        type="button"
        className={btn}
        title="Continue (F5 while stopped)"
        disabled={!stopped}
        onClick={() => void debugContinue()}
      >
        <Play size={14} />
      </button>
      <button
        type="button"
        className={btn}
        title="Step Over"
        disabled={!stopped}
        onClick={() => void debugStepOver()}
      >
        <SkipForward size={14} />
      </button>
      <button
        type="button"
        className={btn}
        title="Step Into"
        disabled={!stopped}
        onClick={() => void debugStepIn()}
      >
        <ArrowDownToLine size={14} />
      </button>
      <button
        type="button"
        className={btn}
        title="Step Out"
        disabled={!stopped}
        onClick={() => void debugStepOut()}
      >
        <ArrowUpFromLine size={14} />
      </button>
      <button
        type="button"
        className={btn}
        title="Stop"
        disabled={!active}
        onClick={() => void stopDebugging()}
      >
        <Square size={14} className="text-pide-error" />
      </button>
      <span className="ml-2 text-[11px] text-pide-muted truncate">
        {debugState === "idle"
          ? "Debug idle"
          : debugState === "starting"
            ? "Starting…"
            : debugState === "running"
              ? "Running"
              : `Stopped (${debugStopReason || "breakpoint"})`}
      </span>
    </div>
  );
}

/** Stack, variables, and debug console for the bottom panel Debug tab. */
export function DebugPanelBody() {
  const frames = useIdeStore((s) => s.debugStackFrames);
  const variables = useIdeStore((s) => s.debugVariables);
  const consoleLines = useIdeStore((s) => s.debugConsoleLines);
  const selectDebugFrame = useIdeStore((s) => s.selectDebugFrame);
  const debugState = useIdeStore((s) => s.debugState);

  if (debugState === "idle" && !frames.length && !consoleLines.length) {
    return (
      <p className="p-2 text-xs text-pide-muted">
        Press F5 to start debugging (requires launch.json + debugpy for Python). Click the
        editor glyph margin to set breakpoints. Program print() output appears in Console
        below.
      </p>
    );
  }

  const stopped = debugState === "stopped";

  return (
    <div className="flex flex-col gap-1.5 h-full min-h-0 p-2 text-[11px]">
      <div className="flex-1 min-h-0 overflow-auto border border-pide-sidebar-border/50 rounded p-1.5 font-mono">
        <div className="text-pide-muted mb-1 font-sans sticky top-0 bg-pide-editor/95 backdrop-blur-sm">
          Console
        </div>
        {!consoleLines.length && (
          <span className="text-pide-muted">Program output (print) shows here</span>
        )}
        {consoleLines.map((line, i) => (
          <div key={`${i}-${line.slice(0, 24)}`} className="whitespace-pre-wrap break-all leading-relaxed">
            {line}
          </div>
        ))}
      </div>
      <div
        className={`flex gap-1.5 shrink-0 ${stopped ? "h-[5.5rem]" : "h-[3.25rem]"} min-h-0`}
        title={
          stopped
            ? "Paused: inspect frames and locals"
            : "Filled when stopped on a breakpoint"
        }
      >
        <div className="flex-1 min-w-0 overflow-auto border border-pide-sidebar-border/40 rounded px-1 py-0.5 opacity-90">
          <div className="text-pide-muted mb-0.5 truncate">Call stack</div>
          {!frames.length && <span className="text-pide-muted">—</span>}
          {frames.map((f) => (
            <button
              key={f.id}
              type="button"
              className="block w-full text-left truncate hover:bg-pide-list-hover px-0.5 rounded"
              onClick={() => void selectDebugFrame(f.id)}
              title={f.sourcePath}
            >
              {f.name}
              {f.line != null ? `:${f.line}` : ""}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-0 overflow-auto border border-pide-sidebar-border/40 rounded px-1 py-0.5 opacity-90">
          <div className="text-pide-muted mb-0.5 truncate">Variables</div>
          {variables.map((v, i) => (
            <div key={`${v.name}-${i}`} className="truncate font-mono">
              <span className="text-pide-link">{v.name}</span>
              <span className="text-pide-muted"> = </span>
              <span className="text-pide-fg">{v.value}</span>
            </div>
          ))}
          {!variables.length && <span className="text-pide-muted">—</span>}
        </div>
      </div>
    </div>
  );
}
