import type { ButtonHTMLAttributes, ReactNode } from "react";

export default function IconButton({
  title,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={`p-1.5 rounded text-[var(--pide-activityBar-inactiveForeground)] hover:text-pide-sidebar-fg hover:bg-pide-list-hover transition-colors duration-150 disabled:opacity-40 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
