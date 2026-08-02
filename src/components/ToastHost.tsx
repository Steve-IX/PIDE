import { useIdeStore } from "../stores/ideStore";

export default function ToastHost() {
  const toasts = useIdeStore((s) => s.toasts);
  const dismissToast = useIdeStore((s) => s.dismissToast);

  if (!toasts.length) return null;

  return (
    <div className="fixed bottom-8 right-4 z-[100] flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-md border px-3 py-2 text-sm shadow-lg backdrop-blur transition-all duration-200 ${
            t.kind === "error"
              ? "bg-[var(--pide-notifications-background)] border-pide-git-del text-pide-error"
              : t.kind === "success"
                ? "bg-[var(--pide-notifications-background)] border-pide-git-add text-pide-git-add"
                : "bg-[var(--pide-notifications-background)] border-[var(--pide-notifications-border)] text-[var(--pide-notifications-foreground)]"
          }`}
        >
          <div className="flex items-start gap-2">
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              className="opacity-60 hover:opacity-100 transition-colors duration-150"
              onClick={() => dismissToast(t.id)}
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
