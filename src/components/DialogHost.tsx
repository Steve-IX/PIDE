import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIdeStore } from "../stores/ideStore";

export default function DialogHost() {
  const confirmDialog = useIdeStore((s) => s.confirmDialog);
  const promptDialog = useIdeStore((s) => s.promptDialog);

  return (
    <>
      {confirmDialog
        ? createPortal(<ConfirmModal dialog={confirmDialog} />, document.body)
        : null}
      {promptDialog
        ? createPortal(<PromptModal dialog={promptDialog} />, document.body)
        : null}
    </>
  );
}

function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 pide-fade-in">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-md">{children}</div>
    </div>
  );
}

function ConfirmModal({
  dialog,
}: {
  dialog: NonNullable<ReturnType<typeof useIdeStore.getState>["confirmDialog"]>;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    cardRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dialog.resolve(false);
      if (e.key === "Enter") dialog.resolve(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog]);

  return (
    <Backdrop>
      <div
        ref={cardRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pide-confirm-title"
        aria-describedby="pide-confirm-msg"
        className="rounded-xl border border-pide-widget-border bg-pide-widget shadow-2xl outline-none overflow-hidden"
      >
        <div className="px-5 pt-5 pb-4 space-y-2">
          <h2 id="pide-confirm-title" className="text-sm font-semibold text-pide-fg tracking-tight">
            {dialog.title}
          </h2>
          <p id="pide-confirm-msg" className="text-sm text-pide-muted leading-relaxed">
            {dialog.message}
          </p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-pide-widget-border bg-black/10">
          <button
            type="button"
            className="px-3.5 py-1.5 rounded-lg text-sm text-pide-fg
              bg-[var(--pide-button-secondaryBackground)] hover:bg-pide-list-hover transition-colors duration-150"
            onClick={() => dialog.resolve(false)}
          >
            {dialog.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            autoFocus
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors duration-150 ${
              dialog.danger
                ? "bg-[var(--pide-errorForeground)]/90 text-white hover:opacity-90"
                : "bg-pide-button text-pide-button-fg hover:bg-pide-button-hover"
            }`}
            onClick={() => dialog.resolve(true)}
          >
            {dialog.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

function PromptModal({
  dialog,
}: {
  dialog: NonNullable<ReturnType<typeof useIdeStore.getState>["promptDialog"]>;
}) {
  const [value, setValue] = useState(dialog.defaultValue ?? "");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setValue(dialog.defaultValue ?? "");
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(t);
  }, [dialog]);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    dialog.resolve(trimmed);
  }

  return (
    <Backdrop>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pide-prompt-title"
        className="rounded-xl border border-pide-widget-border bg-pide-widget shadow-2xl overflow-hidden"
      >
        <div className="px-5 pt-5 pb-4 space-y-3">
          <h2 id="pide-prompt-title" className="text-sm font-semibold text-pide-fg tracking-tight">
            {dialog.title}
          </h2>
          {dialog.message ? (
            <p className="text-xs text-pide-muted leading-relaxed">{dialog.message}</p>
          ) : null}
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") dialog.resolve(null);
            }}
            placeholder={dialog.placeholder}
            className="w-full bg-pide-input border border-pide-input-border rounded-lg px-3 py-2.5 text-sm
              text-pide-input-fg focus:outline-none focus:border-pide-focus transition-colors duration-150
              placeholder:text-[var(--pide-input-placeholderForeground)]"
          />
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-pide-widget-border bg-black/10">
          <button
            type="button"
            className="px-3.5 py-1.5 rounded-lg text-sm text-pide-fg
              bg-[var(--pide-button-secondaryBackground)] hover:bg-pide-list-hover transition-colors duration-150"
            onClick={() => dialog.resolve(null)}
          >
            {dialog.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            disabled={!value.trim()}
            className="px-3.5 py-1.5 rounded-lg text-sm font-medium bg-pide-button text-pide-button-fg
              hover:bg-pide-button-hover disabled:opacity-40 transition-colors duration-150"
            onClick={submit}
          >
            {dialog.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </Backdrop>
  );
}
