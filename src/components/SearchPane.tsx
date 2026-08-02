import { useState } from "react";
import { Search } from "lucide-react";
import { searchWorkspace, type SearchMatch } from "../services/search";
import { useIdeStore } from "../stores/ideStore";
import { fileName } from "../services/fs";
import ViewHeader from "./ui/ViewHeader";

export default function SearchPane() {
  const workspacePath = useIdeStore((s) => s.workspacePath);
  const openFileAt = useIdeStore((s) => s.openFileAt);
  const pushToast = useIdeStore((s) => s.pushToast);
  const addProblem = useIdeStore((s) => s.addProblem);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [loading, setLoading] = useState(false);

  async function runSearch() {
    if (!workspacePath) {
      pushToast("error", "Open a workspace first");
      return;
    }
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const matches = await searchWorkspace(workspacePath, q);
      setResults(matches);
      if (!matches.length) pushToast("info", "No matches");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushToast("error", msg);
      addProblem({
        severity: "error",
        source: "search",
        message: msg,
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full flex flex-col bg-pide-sidebar">
      <ViewHeader title="Search" />
      <div className="p-2 border-b border-pide-sidebar-border space-y-2">
        <div className="flex gap-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runSearch();
            }}
            placeholder="Search in files…"
            className="flex-1 bg-pide-input border border-pide-input-border rounded px-2 py-1.5 text-sm text-pide-input-fg focus:outline-none focus:border-pide-focus transition-colors duration-150"
          />
          <button
            type="button"
            onClick={() => void runSearch()}
            disabled={loading}
            className="px-2 rounded bg-pide-button hover:bg-pide-button-hover text-pide-button-fg disabled:opacity-40 transition-colors duration-150"
            title="Search"
          >
            <Search size={16} />
          </button>
        </div>
        <div className="text-[11px] text-pide-muted">
          {loading ? "Searching…" : `${results.length} result${results.length === 1 ? "" : "s"}`}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {!workspacePath && (
          <p className="p-3 text-sm text-pide-muted">Open a folder to search.</p>
        )}
        {results.map((r, i) => (
          <button
            key={`${r.path}:${r.line}:${i}`}
            type="button"
            className="w-full text-left px-3 py-2 border-b border-pide-sidebar-border/60 hover:bg-pide-list-hover transition-colors duration-150"
            onClick={() => void openFileAt(r.path, r.line, r.column)}
          >
            <div className="text-xs text-pide-link truncate">
              {fileName(r.path)}
              <span className="text-pide-muted">:{r.line}</span>
            </div>
            <div className="text-[11px] text-pide-muted truncate mb-0.5">
              {workspacePath
                ? r.path.replace(workspacePath, "").replace(/^[\\/]/, "")
                : r.path}
            </div>
            <div className="text-xs text-pide-sidebar-fg truncate font-mono">{r.preview}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
