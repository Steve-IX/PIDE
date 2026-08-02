import type { ReactNode } from "react";

export default function ViewHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div className="h-9 px-3 flex items-center justify-between border-b border-pide-sidebar-border bg-pide-sidebar shrink-0">
      <span className="text-[11px] tracking-wider uppercase text-[var(--pide-sideBarTitle-foreground)] font-semibold">
        {title}
      </span>
      {actions ? <div className="flex items-center gap-0.5">{actions}</div> : null}
    </div>
  );
}
