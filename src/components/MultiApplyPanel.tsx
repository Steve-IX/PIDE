import { useIdeStore } from "../stores/ideStore";
import { fileName } from "../services/fs";

export default function MultiApplyPanel() {
  const proposals = useIdeStore((s) => s.fileProposals);
  const toggleProposalSelected = useIdeStore((s) => s.toggleProposalSelected);
  const applySelectedProposals = useIdeStore((s) => s.applySelectedProposals);
  const reviewProposal = useIdeStore((s) => s.reviewProposal);
  const setFileProposals = useIdeStore((s) => s.setFileProposals);

  if (!proposals.length) return null;

  return (
    <div className="border-t border-pide-sidebar-border bg-pide-editor/80 px-2 py-2 space-y-2 shrink-0 max-h-48 overflow-auto">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-pide-muted font-semibold">
          Multi-file proposals ({proposals.length})
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            className="text-[11px] px-2 py-0.5 rounded bg-pide-button hover:bg-pide-button-hover text-pide-button-fg transition-colors duration-150"
            onClick={() => void applySelectedProposals()}
          >
            Apply selected
          </button>
          <button
            type="button"
            className="text-[11px] px-2 py-0.5 rounded bg-pide-list-hover hover:bg-pide-list-active text-pide-sidebar-fg transition-colors duration-150"
            onClick={() => setFileProposals([])}
          >
            Dismiss
          </button>
        </div>
      </div>
      <ul className="space-y-1">
        {proposals.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-2 text-xs text-pide-sidebar-fg bg-pide-sidebar/80 rounded px-2 py-1"
          >
            <input
              type="checkbox"
              checked={p.selected}
              onChange={() => toggleProposalSelected(p.id)}
            />
            <span className="truncate flex-1 font-mono" title={p.path}>
              {fileName(p.path)}
              <span className="text-pide-muted"> · {p.path}</span>
            </span>
            <button
              type="button"
              className="px-1.5 py-0.5 rounded bg-pide-list-hover hover:bg-pide-list-active transition-colors duration-150"
              onClick={() => void reviewProposal(p.id)}
            >
              Diff
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
