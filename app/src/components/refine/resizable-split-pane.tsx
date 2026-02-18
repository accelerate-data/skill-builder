import { useCallback, useEffect, useRef, useState } from "react";

interface ResizableSplitPaneProps {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultLeftPercent?: number;
}

export function ResizableSplitPane({
  left,
  right,
  defaultLeftPercent = 50,
}: ResizableSplitPaneProps) {
  const [leftPercent, setLeftPercent] = useState(defaultLeftPercent);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingPercentRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const onMouseDown = useCallback(() => {
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const percent = ((e.clientX - rect.left) / rect.width) * 100;
      pendingPercentRef.current = Math.min(80, Math.max(20, percent));

      // Batch updates to one per animation frame
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          if (pendingPercentRef.current !== null) {
            setLeftPercent(pendingPercentRef.current);
            pendingPercentRef.current = null;
          }
          rafIdRef.current = null;
        });
      }
    };

    const onMouseUp = () => {
      setDragging(false);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      // Apply final position
      if (pendingPercentRef.current !== null) {
        setLeftPercent(pendingPercentRef.current);
        pendingPercentRef.current = null;
      }
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [dragging]);

  return (
    <div
      ref={containerRef}
      className={`flex h-full w-full overflow-hidden ${dragging ? "select-none" : ""}`}
    >
      <div className="min-w-0 overflow-hidden" style={{ width: `${leftPercent}%` }}>
        {left}
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panels"
        tabIndex={0}
        className="w-1 flex-shrink-0 cursor-col-resize bg-border hover:bg-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onMouseDown={onMouseDown}
        onKeyDown={(e) => {
          const step = 2; // 2% per keypress
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            setLeftPercent((prev) => Math.max(20, prev - step));
          } else if (e.key === "ArrowRight") {
            e.preventDefault();
            setLeftPercent((prev) => Math.min(80, prev + step));
          }
        }}
      />
      <div className="min-w-0 flex-1 overflow-hidden">
        {right}
      </div>
    </div>
  );
}
