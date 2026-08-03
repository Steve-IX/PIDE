import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useIdeStore } from "../stores/ideStore";
import { suggestFileName } from "../utils/extFromLang";

export default function MarkdownMessage({ content }: { content: string }) {
  const applyToActiveFile = useIdeStore((s) => s.applyToActiveFile);
  const insertAtCursor = useIdeStore((s) => s.insertAtCursor);
  const activePath = useIdeStore((s) => s.activePath);
  const workspacePath = useIdeStore((s) => s.workspacePath);
  const setCreateFileDialog = useIdeStore((s) => s.setCreateFileDialog);
  const pushToast = useIdeStore((s) => s.pushToast);

  const components: Components = {
    pre({ children }) {
      return <>{children}</>;
    },
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || "");
      const code = String(children).replace(/\n$/, "");
      const isBlock = Boolean(match) || code.includes("\n");
      const lang = match?.[1] ?? "plaintext";

      if (!isBlock) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      }

      return (
        <div className="my-2 rounded-md border border-pide-sidebar-border overflow-hidden bg-pide-editor">
          <div className="flex items-center justify-between px-2 py-1 bg-pide-sidebar border-b border-pide-sidebar-border text-[11px] text-pide-muted gap-1 flex-wrap">
            <span>{lang}</span>
            <div className="flex gap-1 flex-wrap">
              <button
                type="button"
                className="px-2 py-0.5 rounded bg-pide-list-hover hover:bg-pide-list-active text-pide-fg disabled:opacity-40 transition-colors duration-150"
                disabled={!activePath}
                title={activePath ? "Apply with diff preview" : "No file open"}
                onClick={() => applyToActiveFile(code)}
              >
                Apply to current
              </button>
              <button
                type="button"
                className="px-2 py-0.5 rounded bg-pide-button hover:bg-pide-button-hover text-pide-button-fg disabled:opacity-40 transition-colors duration-150"
                disabled={!workspacePath}
                onClick={() =>
                  setCreateFileDialog({
                    parentDir: workspacePath,
                    initialName: suggestFileName(lang, "untitled"),
                    content: code,
                  })
                }
              >
                Create file & apply
              </button>
              <button
                type="button"
                className="px-2 py-0.5 rounded bg-pide-list-hover hover:bg-pide-list-active text-pide-fg disabled:opacity-40 transition-colors duration-150"
                disabled={!activePath}
                onClick={() => insertAtCursor(code)}
              >
                Insert
              </button>
              <button
                type="button"
                className="px-2 py-0.5 rounded bg-pide-list-hover hover:bg-pide-list-active text-pide-fg transition-colors duration-150"
                onClick={() => {
                  void import("../services/clipboard").then(({ clipboardWrite }) =>
                    clipboardWrite(code).then(() => pushToast("info", "Copied")),
                  );
                }}
              >
                Copy
              </button>
            </div>
          </div>
          <pre className="!m-0 !border-0 !rounded-none overflow-x-auto p-3">
            <code className={className}>{code}</code>
          </pre>
        </div>
      );
    },
  };

  return (
    <div className="chat-markdown text-sm text-pide-fg leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
