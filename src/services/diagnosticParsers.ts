import type { ProblemItem } from "../types";
import { joinPath } from "./fs";

export const COMPILER_PROBLEM_SOURCES = ["tsc", "rustc", "gcc", "task"] as const;

export type ProblemDraft = Omit<ProblemItem, "id">;

const TSC_RE =
  /^(.+?)\((\d+),(\d+)\):\s+(error|warning|info)\s+TS\d+:\s*(.+)$/i;
const GCC_RE =
  /^(.+?):(\d+):(\d+):\s+(fatal error|error|warning|note):\s*(.+)$/i;
const RUSTC_ARROW_RE = /^\s*-->\s+(.+?):(\d+):(\d+)\s*$/;
const RUSTC_ERROR_RE = /^(error|warning|note)(?:\[E\d+\])?:\s*(.+)$/i;

function severityOf(s: string): ProblemItem["severity"] {
  const x = s.toLowerCase();
  if (x.includes("error") || x.includes("fatal")) return "error";
  if (x.includes("warning")) return "warning";
  return "info";
}

function resolvePath(workspaceRoot: string, file: string): string {
  const f = file.trim().replace(/^file:\/\//, "");
  if (!f) return f;
  if (/^[a-zA-Z]:[\\/]/.test(f) || f.startsWith("/")) return f;
  if (!workspaceRoot) return f;
  return joinPath(workspaceRoot, f.replace(/^\.[/\\]/, ""));
}

function parseLine(line: string, workspaceRoot: string): ProblemDraft | null {
  const tsc = line.match(TSC_RE);
  if (tsc) {
    return {
      severity: severityOf(tsc[4]),
      source: "tsc",
      message: tsc[5].trim(),
      path: resolvePath(workspaceRoot, tsc[1]),
      line: Number(tsc[2]),
      column: Number(tsc[3]),
    };
  }

  const gcc = line.match(GCC_RE);
  if (gcc) {
    return {
      severity: severityOf(gcc[4]),
      source: "gcc",
      message: gcc[5].trim(),
      path: resolvePath(workspaceRoot, gcc[1]),
      line: Number(gcc[2]),
      column: Number(gcc[3]),
    };
  }

  const rustLoc = line.match(RUSTC_ARROW_RE);
  if (rustLoc) {
    return {
      severity: "error",
      source: "rustc",
      message: "compile error",
      path: resolvePath(workspaceRoot, rustLoc[1]),
      line: Number(rustLoc[2]),
      column: Number(rustLoc[3]),
    };
  }

  const rustErr = line.match(RUSTC_ERROR_RE);
  if (rustErr) {
    return {
      severity: severityOf(rustErr[1]),
      source: "rustc",
      message: rustErr[2].trim(),
    };
  }

  return null;
}

/**
 * Stateful line buffer for streaming PTY output into Problems.
 */
export class DiagnosticLineBuffer {
  private partial = "";
  private lastRustMessage: string | null = null;
  private seen = new Set<string>();

  reset(): void {
    this.partial = "";
    this.lastRustMessage = null;
    this.seen.clear();
  }

  feed(chunk: string, workspaceRoot: string): ProblemDraft[] {
    const text = this.partial + chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = text.split("\n");
    this.partial = lines.pop() ?? "";
    const out: ProblemDraft[] = [];

    for (const line of lines) {
      const stripped = line.replace(/\x1b\[[0-9;]*m/g, "");
      const rustErr = stripped.match(RUSTC_ERROR_RE);
      if (rustErr) {
        this.lastRustMessage = rustErr[2].trim();
        continue;
      }
      const rustLoc = stripped.match(RUSTC_ARROW_RE);
      if (rustLoc && this.lastRustMessage) {
        const draft: ProblemDraft = {
          severity: "error",
          source: "rustc",
          message: this.lastRustMessage,
          path: resolvePath(workspaceRoot, rustLoc[1]),
          line: Number(rustLoc[2]),
          column: Number(rustLoc[3]),
        };
        this.lastRustMessage = null;
        const key = `${draft.source}|${draft.path}|${draft.line}|${draft.message}`;
        if (!this.seen.has(key)) {
          this.seen.add(key);
          out.push(draft);
        }
        continue;
      }

      const draft = parseLine(stripped, workspaceRoot);
      if (!draft) continue;
      const key = `${draft.source}|${draft.path ?? ""}|${draft.line ?? 0}|${draft.message}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      out.push(draft);
    }
    return out;
  }
}
