import { invoke } from "@tauri-apps/api/core";

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export async function searchWorkspace(
  workspace: string,
  query: string,
  maxResults = 200,
): Promise<SearchMatch[]> {
  return invoke<SearchMatch[]>("search_workspace", {
    workspace,
    query,
    maxResults,
  });
}
