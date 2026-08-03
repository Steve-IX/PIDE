import { joinPath, readFile } from "./fs";

export type TaskGroupKind = "build" | "test" | "none";

export interface PideTaskGroup {
  kind: TaskGroupKind;
  isDefault?: boolean;
}

export interface PideTask {
  label: string;
  type: "shell" | "process";
  command: string;
  args?: string[];
  options?: { cwd?: string };
  group?: TaskGroupKind | PideTaskGroup;
  problemMatcher?: string | string[];
}

interface RawTasksFile {
  version?: string;
  tasks?: unknown[];
}

function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function normalizeGroup(
  group: PideTask["group"],
): PideTaskGroup | undefined {
  if (!group) return undefined;
  if (typeof group === "string") {
    if (group === "build" || group === "test" || group === "none") {
      return { kind: group };
    }
    return undefined;
  }
  const kind = group.kind === "test" || group.kind === "none" ? group.kind : "build";
  return { kind, isDefault: group.isDefault };
}

function parseTask(raw: unknown): PideTask | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.label !== "string" || !t.label.trim()) return null;
  if (typeof t.command !== "string" || !t.command.trim()) return null;
  const type = t.type === "process" ? "process" : "shell";
  const args = Array.isArray(t.args)
    ? t.args.filter((a): a is string => typeof a === "string")
    : undefined;
  let options: PideTask["options"];
  if (t.options && typeof t.options === "object") {
    const cwd = (t.options as { cwd?: unknown }).cwd;
    if (typeof cwd === "string") options = { cwd };
  }
  let problemMatcher: string | string[] | undefined;
  if (typeof t.problemMatcher === "string") problemMatcher = t.problemMatcher;
  else if (Array.isArray(t.problemMatcher)) {
    problemMatcher = t.problemMatcher.filter((m): m is string => typeof m === "string");
  }
  return {
    label: t.label.trim(),
    type,
    command: t.command,
    args,
    options,
    group: normalizeGroup(t.group as PideTask["group"]),
    problemMatcher,
  };
}

async function readTasksFile(
  workspacePath: string,
  relativeJson: string,
): Promise<PideTask[]> {
  const path = joinPath(workspacePath, relativeJson);
  try {
    const text = await readFile(workspacePath, path);
    const data = JSON.parse(text) as RawTasksFile;
    if (!Array.isArray(data.tasks)) return [];
    return data.tasks.map(parseTask).filter((t): t is PideTask => Boolean(t));
  } catch {
    return [];
  }
}

/** Merge vscode + pide tasks; same label → pide wins. */
export async function loadWorkspaceTasks(workspacePath: string): Promise<PideTask[]> {
  if (!workspacePath) return [];
  const fromVscode = await readTasksFile(workspacePath, ".vscode/tasks.json");
  const fromPide = await readTasksFile(workspacePath, ".pide/tasks.json");
  const map = new Map<string, PideTask>();
  for (const t of fromVscode) map.set(t.label, t);
  for (const t of fromPide) map.set(t.label, t);
  return [...map.values()];
}

export function resolveTaskCommand(task: PideTask, workspacePath: string): string {
  const args = (task.args ?? []).map(psQuote).join(" ");
  const body =
    task.type === "process"
      ? `& ${psQuote(task.command)}${args ? ` ${args}` : ""}`
      : args
        ? `${task.command} ${args}`
        : task.command;

  const cwdRel = task.options?.cwd?.trim();
  if (cwdRel) {
    const sep = workspacePath.includes("\\") ? "\\" : "/";
    const abs = cwdRel.match(/^[a-zA-Z]:[\\/]/) || cwdRel.startsWith("/")
      ? cwdRel
      : `${workspacePath.replace(/[\\/]+$/, "")}${sep}${cwdRel.replace(/^[/\\]+/, "")}`;
    return `Set-Location ${psQuote(abs)}; ${body}`;
  }
  return body;
}

export function pickDefaultBuildTask(tasks: PideTask[]): PideTask | null {
  const builds = tasks.filter((t) => {
    const g = normalizeGroup(t.group);
    return g?.kind === "build";
  });
  const def = builds.find((t) => normalizeGroup(t.group)?.isDefault);
  if (def) return def;
  if (builds[0]) return builds[0];
  return tasks[0] ?? null;
}

export function matcherIdsForTask(task: PideTask): string[] {
  const raw = task.problemMatcher;
  if (!raw) return ["$tsc", "$rustc", "$gcc"];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.length ? list : ["$tsc", "$rustc", "$gcc"];
}
