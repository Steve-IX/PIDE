import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  gitCommit,
  gitDiff,
  gitFetch,
  gitPull,
  gitPush,
  gitRemoteInfo,
  gitStage,
  gitStatus,
  gitSync,
  gitUnstage,
  type GitRemoteInfo,
  type GitStatus,
  type GitStatusEntry,
} from "../services/git";
import { useIdeStore } from "../stores/ideStore";
import { joinPath } from "../services/fs";
import GitHubAuthButton from "./GitHubAuthButton";
import type { GitHubUser } from "../services/githubAuth";
import ViewHeader from "./ui/ViewHeader";
import IconButton from "./ui/IconButton";

export default function GitPane() {
  const workspacePath = useIdeStore((s) => s.workspacePath);
  const pushToast = useIdeStore((s) => s.pushToast);
  const addProblem = useIdeStore((s) => s.addProblem);
  const openFile = useIdeStore((s) => s.openFile);

  const [status, setStatus] = useState<GitStatus | null>(null);
  const [remote, setRemote] = useState<GitRemoteInfo | null>(null);
  const [ghUser, setGhUser] = useState<GitHubUser | null>(null);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<GitStatusEntry | null>(null);
  const [diffText, setDiffText] = useState("");
  const [loading, setLoading] = useState(false);
  const [remoteBusy, setRemoteBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        gitStatus(workspacePath),
        gitRemoteInfo(workspacePath),
      ]);
      setStatus(s);
      setRemote(r);
      if (s.error) {
        addProblem({ severity: "warning", source: "git", message: s.error });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({
        isRepo: false,
        branch: "",
        entries: [],
        error: msg,
      });
      pushToast("error", msg);
      addProblem({ severity: "error", source: "git", message: msg });
    } finally {
      setLoading(false);
    }
  }, [workspacePath, addProblem, pushToast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!workspacePath) return;
      setLoading(true);
      try {
        const [s, r] = await Promise.all([
          gitStatus(workspacePath),
          gitRemoteInfo(workspacePath),
        ]);
        if (!cancelled) {
          setStatus(s);
          setRemote(r);
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setStatus({
            isRepo: false,
            branch: "",
            entries: [],
            error: msg,
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  async function showDiff(entry: GitStatusEntry) {
    if (!workspacePath) return;
    setSelected(entry);
    try {
      const text = await gitDiff(
        workspacePath,
        entry.path,
        entry.staged && !entry.unstaged,
      );
      setDiffText(text || "(no textual diff)");
    } catch (err) {
      setDiffText(err instanceof Error ? err.message : String(err));
    }
  }

  async function stage(entry: GitStatusEntry) {
    if (!workspacePath) return;
    try {
      await gitStage(workspacePath, entry.path);
      pushToast("success", `Staged ${entry.path}`);
      await refresh();
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    }
  }

  async function unstage(entry: GitStatusEntry) {
    if (!workspacePath) return;
    try {
      await gitUnstage(workspacePath, entry.path);
      pushToast("success", `Unstaged ${entry.path}`);
      await refresh();
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    }
  }

  async function commit() {
    if (!workspacePath) return;
    try {
      const out = await gitCommit(workspacePath, message);
      pushToast("success", out || "Committed");
      setMessage("");
      await refresh();
    } catch (err) {
      pushToast("error", err instanceof Error ? err.message : String(err));
    }
  }

  async function runRemote(
    label: string,
    fn: (ws: string) => Promise<string>,
  ) {
    if (!workspacePath) return;
    setRemoteBusy(true);
    try {
      const out = await fn(workspacePath);
      pushToast("success", out || `${label} ok`);
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushToast("error", msg);
      addProblem({ severity: "error", source: "git", message: msg });
    } finally {
      setRemoteBusy(false);
    }
  }

  if (!workspacePath) {
    return (
      <div className="h-full bg-pide-sidebar p-3 text-sm text-pide-muted">
        Open a folder to use Source Control.
      </div>
    );
  }

  const hasRemote = Boolean(remote?.remote);
  const canRemote = Boolean(status?.isRepo && hasRemote && ghUser && !remoteBusy);
  const branch = remote?.branch || status?.branch || "(detached)";
  const upstream = remote?.upstream;
  const remoteLabel = !status?.isRepo
    ? status?.error || "Not a git repository"
    : !hasRemote
      ? `${branch} · No remote`
      : !ghUser
        ? `${branch}${upstream ? ` ↔ ${upstream}` : ""} · Not authenticated`
        : upstream
          ? `${branch} ↔ ${upstream} ↑${remote?.ahead ?? 0} ↓${remote?.behind ?? 0}`
          : `${branch} · ${remote?.remote} (no upstream)`;

  return (
    <div className="h-full flex flex-col bg-pide-sidebar">
      <ViewHeader
        title="Source Control"
        actions={
          <IconButton title="Refresh" onClick={() => void refresh()}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </IconButton>
        }
      />

      <div className="p-2 border-b border-pide-sidebar-border space-y-2">
        <GitHubAuthButton onSessionChange={setGhUser} />

        <div className="text-xs text-pide-muted font-mono leading-relaxed">
          {loading && !status ? "Checking git…" : remoteLabel}
        </div>

        <div className="grid grid-cols-4 gap-1">
          {(
            [
              ["Fetch", gitFetch],
              ["Pull", gitPull],
              ["Push", gitPush],
              ["Sync", gitSync],
            ] as const
          ).map(([label, fn]) => (
            <button
              key={label}
              type="button"
              onClick={() => void runRemote(label, fn)}
              disabled={!canRemote}
              className="py-1 rounded bg-pide-list-hover hover:bg-pide-list-active disabled:opacity-40 text-[11px] text-pide-fg transition-colors duration-150"
              title={
                !ghUser
                  ? "Sign in first"
                  : !hasRemote
                    ? "No remote configured"
                    : label
              }
            >
              {label}
            </button>
          ))}
        </div>

        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={2}
          placeholder="Commit message"
          disabled={!status?.isRepo}
          className="w-full bg-pide-input border border-pide-input-border rounded px-2 py-1.5 text-sm text-pide-input-fg disabled:opacity-40 transition-colors duration-150"
        />
        <button
          type="button"
          onClick={() => void commit()}
          disabled={!status?.isRepo || !message.trim()}
          className="w-full py-1.5 rounded bg-pide-button hover:bg-pide-button-hover disabled:opacity-40 text-sm text-pide-button-fg transition-colors duration-150"
        >
          Commit
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex-1 overflow-auto border-b border-pide-sidebar-border">
          {(status?.entries ?? []).map((e) => (
            <div
              key={`${e.path}-${e.indexStatus}${e.worktreeStatus}`}
              className={`px-2 py-1.5 text-xs border-b border-pide-sidebar-border/50 transition-colors duration-150 ${
                selected?.path === e.path ? "bg-pide-list-hover" : "hover:bg-pide-list-hover/50"
              }`}
            >
              <button
                type="button"
                className="w-full text-left text-pide-fg truncate"
                onClick={() => void showDiff(e)}
                onDoubleClick={() =>
                  void openFile(
                    e.path.includes(":") || e.path.startsWith("/")
                      ? e.path
                      : joinPath(workspacePath, e.path),
                  )
                }
                title={e.path}
              >
                <span className="text-pide-git-mod font-mono mr-2">
                  {e.untracked ? "U" : `${e.indexStatus}${e.worktreeStatus}`}
                </span>
                {e.path}
              </button>
              <div className="flex gap-1 mt-1">
                {e.unstaged || e.untracked ? (
                  <button
                    type="button"
                    className="px-1.5 py-0.5 rounded bg-pide-list-hover hover:bg-pide-list-active text-pide-sidebar-fg transition-colors duration-150"
                    onClick={() => void stage(e)}
                  >
                    Stage
                  </button>
                ) : null}
                {e.staged ? (
                  <button
                    type="button"
                    className="px-1.5 py-0.5 rounded bg-pide-list-hover hover:bg-pide-list-active text-pide-sidebar-fg transition-colors duration-150"
                    onClick={() => void unstage(e)}
                  >
                    Unstage
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {status?.isRepo && !(status.entries?.length) && (
            <p className="p-3 text-xs text-pide-muted">No changes</p>
          )}
        </div>
        {selected && (
          <pre className="h-40 min-h-0 overflow-auto p-2 text-[11px] font-mono text-pide-sidebar-fg bg-pide-editor whitespace-pre-wrap">
            {diffText || "Select a file to preview diff."}
          </pre>
        )}
      </div>
    </div>
  );
}
