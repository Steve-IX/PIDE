import { useCallback, useEffect, useRef, useState } from "react";
import { Github, LogOut } from "lucide-react";
import {
  clearGitHubSession,
  completeDeviceFlow,
  githubAuthErrorMessage,
  loadGitHubSession,
  savePat,
  startDeviceFlow,
  type GitHubUser,
} from "../services/githubAuth";
import { useIdeStore } from "../stores/ideStore";

interface Props {
  compact?: boolean;
  onSessionChange?: (user: GitHubUser | null) => void;
}

export default function GitHubAuthButton({ compact, onSessionChange }: Props) {
  const settings = useIdeStore((s) => s.settings);
  const pushToast = useIdeStore((s) => s.pushToast);

  const [user, setUser] = useState<GitHubUser | null>(null);
  const [busy, setBusy] = useState(false);
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [verifyUri, setVerifyUri] = useState<string | null>(null);
  const [showPat, setShowPat] = useState(false);
  const [pat, setPat] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const notify = useCallback(
    (u: GitHubUser | null) => {
      setUser(u);
      onSessionChange?.(u);
    },
    [onSessionChange],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await loadGitHubSession();
        if (!cancelled) notify(s);
      } catch {
        if (!cancelled) notify(null);
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [notify]);

  async function signInDevice() {
    const clientId = settings.githubClientId.trim();
    if (!clientId) {
      pushToast("error", "Set GitHub Client ID in Settings, or use a PAT.");
      setShowPat(true);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setDeviceCode(null);
    try {
      const start = await startDeviceFlow(clientId);
      setDeviceCode(start.userCode);
      setVerifyUri(start.verificationUri);
      try {
        await navigator.clipboard.writeText(start.userCode);
        pushToast("info", `Code ${start.userCode} copied — paste on GitHub`);
      } catch {
        pushToast("info", `Enter code ${start.userCode} on GitHub`);
      }
      window.open(start.verificationUri, "_blank", "noopener,noreferrer");
      const u = await completeDeviceFlow(clientId, start, { signal: ac.signal });
      notify(u);
      pushToast("success", `Signed in as ${u.login}`);
      setDeviceCode(null);
      setVerifyUri(null);
    } catch (err) {
      const msg = githubAuthErrorMessage(err);
      if (!msg.toLowerCase().includes("cancelled")) {
        pushToast("error", msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function signInPat() {
    setBusy(true);
    try {
      const u = await savePat(pat);
      notify(u);
      setPat("");
      setShowPat(false);
      pushToast("success", `Signed in as ${u.login}`);
    } catch (err) {
      pushToast("error", githubAuthErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    abortRef.current?.abort();
    setBusy(true);
    try {
      await clearGitHubSession();
      notify(null);
      setDeviceCode(null);
      pushToast("info", "Signed out of GitHub");
    } catch (err) {
      pushToast("error", githubAuthErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (user) {
    return (
      <div className={`flex items-center gap-2 ${compact ? "" : "w-full"}`}>
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt=""
            className="w-5 h-5 rounded-full bg-pide-list-hover"
          />
        ) : (
          <Github size={14} className="text-pide-muted" />
        )}
        <span className="text-xs text-pide-fg truncate flex-1" title={user.login}>
          {user.login}
        </span>
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={busy}
          className="p-1 rounded text-pide-muted hover:text-pide-fg hover:bg-pide-list-hover transition-colors duration-150"
          title="Sign out"
        >
          <LogOut size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 w-full">
      <div className="flex gap-1 flex-wrap">
        <button
          type="button"
          onClick={() => void signInDevice()}
          disabled={busy}
          className="flex-1 min-w-[8rem] py-1.5 px-2 rounded bg-pide-list-hover hover:bg-pide-list-active text-xs text-pide-fg disabled:opacity-40 inline-flex items-center justify-center gap-1.5 transition-colors duration-150"
        >
          <Github size={13} />
          {busy && deviceCode ? "Waiting…" : "Sign in with GitHub"}
        </button>
        <button
          type="button"
          onClick={() => setShowPat((v) => !v)}
          disabled={busy}
          className="py-1.5 px-2 rounded bg-pide-sidebar border border-pide-sidebar-border hover:bg-pide-list-hover text-xs text-pide-sidebar-fg disabled:opacity-40 transition-colors duration-150"
        >
          PAT
        </button>
      </div>
      {deviceCode && (
        <p className="text-[11px] text-pide-muted leading-relaxed">
          Code <span className="font-mono text-pide-fg">{deviceCode}</span>
          {verifyUri ? (
            <>
              {" "}
              at{" "}
              <a
                href={verifyUri}
                target="_blank"
                rel="noreferrer"
                className="text-pide-link hover:underline"
              >
                {verifyUri.replace(/^https?:\/\//, "")}
              </a>
            </>
          ) : null}
        </p>
      )}
      {showPat && (
        <div className="space-y-1">
          <input
            type="password"
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            placeholder="ghp_… personal access token"
            className="w-full bg-pide-input border border-pide-input-border rounded px-2 py-1 text-xs text-pide-input-fg transition-colors duration-150"
            disabled={busy}
          />
          <button
            type="button"
            onClick={() => void signInPat()}
            disabled={busy || !pat.trim()}
            className="w-full py-1 rounded bg-pide-button hover:bg-pide-button-hover disabled:opacity-40 text-xs text-pide-button-fg transition-colors duration-150"
          >
            Save PAT
          </button>
        </div>
      )}
    </div>
  );
}
