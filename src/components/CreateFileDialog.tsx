import { useEffect, useState } from "react";
import { useIdeStore } from "../stores/ideStore";

export default function CreateFileDialog() {
  const dialog = useIdeStore((s) => s.createFileDialog);
  const setCreateFileDialog = useIdeStore((s) => s.setCreateFileDialog);
  const createAndApply = useIdeStore((s) => s.createAndApply);
  const createNewFile = useIdeStore((s) => s.createNewFile);
  const [name, setName] = useState("");

  useEffect(() => {
    if (dialog) setName(dialog.initialName);
  }, [dialog]);

  if (!dialog) return null;

  async function submit() {
    const current = dialog;
    if (!current) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    if (current.content) {
      await createAndApply(trimmed, current.content);
    } else {
      await createNewFile(current.parentDir, trimmed, "");
      setCreateFileDialog(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 pide-fade-in">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        onClick={() => setCreateFileDialog(null)}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md rounded-xl border border-pide-widget-border bg-pide-widget shadow-2xl overflow-hidden"
      >
        <div className="px-5 pt-5 pb-4 space-y-3">
          <h2 className="text-sm font-semibold text-pide-fg tracking-tight">
            {dialog.content ? "Create file & apply" : "New file"}
          </h2>
          <p className="text-xs text-pide-muted truncate" title={dialog.parentDir}>
            Folder: {dialog.parentDir}
          </p>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") setCreateFileDialog(null);
            }}
            className="w-full bg-pide-input border border-pide-input-border rounded-lg px-3 py-2.5 text-sm
              text-pide-input-fg focus:outline-none focus:border-pide-focus transition-colors duration-150
              placeholder:text-[var(--pide-input-placeholderForeground)]"
            placeholder="filename.ext"
          />
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-pide-widget-border bg-black/10">
          <button
            type="button"
            className="px-3.5 py-1.5 rounded-lg text-sm text-pide-fg
              bg-[var(--pide-button-secondaryBackground)] hover:bg-pide-list-hover transition-colors duration-150"
            onClick={() => setCreateFileDialog(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!name.trim()}
            className="px-3.5 py-1.5 rounded-lg text-sm font-medium bg-pide-button text-pide-button-fg
              hover:bg-pide-button-hover disabled:opacity-40 transition-colors duration-150"
            onClick={() => void submit()}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
