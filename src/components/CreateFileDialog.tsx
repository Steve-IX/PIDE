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
    <div className="fixed inset-0 z-[90] bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-pide-widget border border-pide-widget-border rounded-lg shadow-2xl p-4 space-y-3">
        <h2 className="text-sm font-semibold text-pide-fg">
          {dialog.content ? "Create file & apply" : "New file"}
        </h2>
        <p className="text-xs text-pide-muted truncate">Folder: {dialog.parentDir}</p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") setCreateFileDialog(null);
          }}
          className="w-full bg-pide-input border border-pide-input-border rounded px-3 py-2 text-sm text-pide-input-fg focus:outline-none focus:border-pide-focus transition-colors duration-150"
          placeholder="filename.ext"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="px-3 py-1.5 rounded bg-pide-list-hover hover:bg-pide-list-active text-sm text-pide-fg transition-colors duration-150"
            onClick={() => setCreateFileDialog(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="px-3 py-1.5 rounded bg-pide-button hover:bg-pide-button-hover text-sm text-pide-button-fg transition-colors duration-150"
            onClick={() => void submit()}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
