import { useEffect, useState } from "react";
import { DiffEditor, loader } from "@monaco-editor/react";
import { useIdeStore } from "../stores/ideStore";
import { fileName } from "../services/fs";
import { MONACO_THEME_ID, getLastAppliedTheme, subscribeTheme } from "../theme";

export default function DiffApplyModal() {
  const diffRequest = useIdeStore((s) => s.diffRequest);
  const setDiffRequest = useIdeStore((s) => s.setDiffRequest);
  const confirmDiffApply = useIdeStore((s) => s.confirmDiffApply);
  const fontSize = useIdeStore((s) => s.settings.editorFontSize);
  const [themeReady, setThemeReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    function apply() {
      const last = getLastAppliedTheme();
      if (!last) return;
      void loader.init().then((monaco) => {
        if (cancelled) return;
        monaco.editor.defineTheme(
          MONACO_THEME_ID,
          last.monaco as Parameters<typeof monaco.editor.defineTheme>[1],
        );
        monaco.editor.setTheme(MONACO_THEME_ID);
        setThemeReady(true);
      });
    }

    apply();
    return subscribeTheme(() => {
      apply();
    });
  }, []);

  if (!diffRequest) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-black/60 flex items-center justify-center p-6">
      <div className="w-full max-w-5xl h-[75vh] bg-pide-widget border border-pide-widget-border rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <div className="h-11 px-4 flex items-center justify-between border-b border-pide-widget-border">
          <div>
            <div className="text-sm text-pide-fg font-medium">
              {diffRequest.isNewFile ? "Create & apply" : "Review apply"}
            </div>
            <div className="text-xs text-pide-muted truncate">{diffRequest.path}</div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="px-3 py-1 rounded bg-pide-list-hover hover:bg-pide-list-active text-sm text-pide-fg transition-colors duration-150"
              onClick={() => setDiffRequest(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded bg-pide-button hover:bg-pide-button-hover text-sm text-pide-button-fg transition-colors duration-150"
              onClick={() => void confirmDiffApply()}
            >
              {diffRequest.isNewFile
                ? `Create ${fileName(diffRequest.path)}`
                : "Apply changes"}
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <DiffEditor
            height="100%"
            theme={themeReady ? MONACO_THEME_ID : "vs-dark"}
            language={diffRequest.language}
            original={diffRequest.original}
            modified={diffRequest.modified}
            options={{
              readOnly: true,
              fontSize,
              renderSideBySide: true,
              automaticLayout: true,
            }}
          />
        </div>
      </div>
    </div>
  );
}
