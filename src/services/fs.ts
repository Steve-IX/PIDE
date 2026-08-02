import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { FileNode } from "../types";

export interface ShellResult {
  stdout: string;
  stderr: string;
  code: number;
  cwd: string;
}

export async function pickWorkspaceFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Open Workspace Folder",
  });
  if (!selected || Array.isArray(selected)) return null;
  return selected;
}

export async function readWorkspaceTree(root: string): Promise<FileNode> {
  return invoke<FileNode>("read_workspace_tree", { root });
}

export async function readFile(workspace: string, path: string): Promise<string> {
  return invoke<string>("read_file", { workspace, path });
}

export async function writeFile(
  workspace: string,
  path: string,
  contents: string,
): Promise<void> {
  return invoke("write_file", { workspace, path, contents });
}

export async function createFile(
  workspace: string,
  path: string,
  contents = "",
): Promise<void> {
  return invoke("create_file", { workspace, path, contents });
}

export async function createDir(workspace: string, path: string): Promise<void> {
  return invoke("create_dir", { workspace, path });
}

export async function renamePath(
  workspace: string,
  from: string,
  to: string,
): Promise<void> {
  return invoke("rename_path", { workspace, from, to });
}

export async function deletePath(workspace: string, path: string): Promise<void> {
  return invoke("delete_path", { workspace, path });
}

export async function runShellCommand(
  cwd: string,
  command: string,
): Promise<ShellResult> {
  return invoke<ShellResult>("run_shell_command", { cwd, command });
}

export function joinPath(base: string, name: string): string {
  const sep = base.includes("\\") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/, "")}${sep}${name}`;
}

export function parentPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, "");
  const idx = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  if (idx <= 0) return normalized;
  return normalized.slice(0, idx);
}

export function fileName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}
