import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";

export default function PaneResizer({
  onDrag,
  direction = "vertical",
}: {
  onDrag: (delta: number) => void;
  direction?: "vertical" | "horizontal";
}) {
  const dragging = useRef(false);
  const last = useRef(0);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragging.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      last.current = direction === "vertical" ? e.clientX : e.clientY;
    },
    [direction],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      const pos = direction === "vertical" ? e.clientX : e.clientY;
      const delta = pos - last.current;
      if (delta !== 0) {
        last.current = pos;
        onDrag(delta);
      }
    },
    [direction, onDrag],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const vertical = direction === "vertical";

  return (
    <div
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={
        vertical
          ? "w-1 shrink-0 cursor-col-resize bg-pide-sidebar-border hover:bg-pide-focus transition-colors duration-150"
          : "h-1 shrink-0 cursor-row-resize bg-pide-sidebar-border hover:bg-pide-focus transition-colors duration-150"
      }
    />
  );
}
