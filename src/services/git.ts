import { invoke } from "@tauri-apps/api/core";

export interface GitStatusEntry {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string;
  entries: GitStatusEntry[];
  error?: string | null;
}

export interface GitRemoteInfo {
  isRepo: boolean;
  branch: string;
  remote?: string | null;
  remoteUrl?: string | null;
  upstream?: string | null;
  ahead: number;
  behind: number;
  error?: string | null;
}

export async function gitStatus(workspace: string): Promise<GitStatus> {
  return invoke<GitStatus>("git_status", { workspace });
}

export async function gitDiff(
  workspace: string,
  path: string,
  staged: boolean,
): Promise<string> {
  return invoke<string>("git_diff", { workspace, path, staged });
}

export async function gitStage(workspace: string, path: string): Promise<void> {
  return invoke("git_stage", { workspace, path });
}

export async function gitUnstage(workspace: string, path: string): Promise<void> {
  return invoke("git_unstage", { workspace, path });
}

export async function gitCommit(workspace: string, message: string): Promise<string> {
  return invoke<string>("git_commit", { workspace, message });
}

export async function gitRemoteInfo(workspace: string): Promise<GitRemoteInfo> {
  return invoke<GitRemoteInfo>("git_remote_info", { workspace });
}

export async function gitFetch(workspace: string): Promise<string> {
  return invoke<string>("git_fetch", { workspace });
}

export async function gitPull(workspace: string): Promise<string> {
  return invoke<string>("git_pull", { workspace });
}

export async function gitPush(workspace: string): Promise<string> {
  return invoke<string>("git_push", { workspace });
}

export async function gitSync(workspace: string): Promise<string> {
  return invoke<string>("git_sync", { workspace });
}
