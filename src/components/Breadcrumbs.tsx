import { useIdeStore } from "../stores/ideStore";
import { joinPath } from "../services/fs";

export default function Breadcrumbs() {
  const activePath = useIdeStore((s) => s.activePath);
  const workspacePath = useIdeStore((s) => s.workspacePath);
  const openFile = useIdeStore((s) => s.openFile);

  if (!activePath || !workspacePath) return null;

  let rel = activePath;
  if (activePath.toLowerCase().startsWith(workspacePath.toLowerCase())) {
    rel = activePath.slice(workspacePath.length).replace(/^[\\/]/, "");
  }
  const parts = rel.split(/[/\\]/).filter(Boolean);
  if (!parts.length) return null;

  return (
    <div className="h-6 px-3 flex items-center gap-1 text-[11px] text-pide-muted border-b border-pide-sidebar-border bg-pide-editor overflow-hidden">
      <span className="truncate opacity-70">
        {workspacePath.split(/[/\\]/).pop()}
      </span>
      {parts.map((part, i) => {
        const segmentPath = joinPath(
          workspacePath,
          parts.slice(0, i + 1).join(workspacePath.includes("\\") ? "\\" : "/"),
        );
        const isLast = i === parts.length - 1;
        return (
          <span key={segmentPath} className="flex items-center gap-1 min-w-0">
            <span className="opacity-40">/</span>
            {isLast ? (
              <span className="text-pide-fg truncate">{part}</span>
            ) : (
              <button
                type="button"
                className="hover:text-pide-fg truncate transition-colors duration-150"
                onClick={() => void openFile(segmentPath)}
              >
                {part}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
