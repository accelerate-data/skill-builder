import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { DisplayNode, DisplayTraceItem } from "@/lib/display-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ConversationActivityGroupProps {
  node: DisplayNode;
}

const TRACE_ICONS: Record<DisplayTraceItem["kind"], string> = {
  skill: "S",
  subagent: "A",
  result: "R",
  terminal_activity: ">",
  file_activity: "F",
  reasoning: ".",
  runtime_setup: "*",
  lifecycle: "o",
  pause: "||",
  error: "!",
  tool_error: "!",
  subagent_error: "!",
};

function buildTracePreview(traceItems: DisplayTraceItem[]): string {
  return traceItems
    .slice(0, 3)
    .map((item) => item.title)
    .join(" · ");
}

export function ConversationActivityGroup({
  node,
}: ConversationActivityGroupProps) {
  const [selectedItem, setSelectedItem] = useState<DisplayTraceItem | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const traceItems = node.traceItems ?? [];

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!selectedItem) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedItem(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedItem]);

  const tracePreview = buildTracePreview(traceItems);

  return (
    <>
      <details
        data-testid="conversation-event-row"
        className="mr-auto w-full max-w-[56%] overflow-hidden rounded-[22px] border border-stone-200/90 bg-[linear-gradient(180deg,rgba(250,250,249,0.95),rgba(246,245,243,0.9))] shadow-[0_12px_24px_-24px_rgba(28,25,23,0.18)]"
        open={!node.collapsedByDefault}
      >
        <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-3.5 py-2.5 hover:bg-stone-100/70">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-[0.92rem] font-semibold tracking-[-0.02em] text-stone-900">
                {node.label ?? "Activity trace"}
              </p>
              <span className="rounded-full border border-stone-200 bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500">
                {traceItems.length} item{traceItems.length === 1 ? "" : "s"}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-5 text-stone-500">
              {tracePreview.length > 0
                ? tracePreview
                : `${traceItems.length} trace item${traceItems.length === 1 ? "" : "s"} available in the shared activity timeline.`}
            </p>
          </div>
          <span className="mt-0.5 text-xs font-semibold uppercase tracking-[0.08em] text-stone-400">
            Open
          </span>
        </summary>
        <div className="border-t border-stone-200/80 bg-white/70 px-2.5 py-2.5">
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {traceItems.slice(0, 4).map((item) => (
              <span
                key={`${item.id}:summary-chip`}
                className="rounded-full border border-stone-200 bg-stone-50/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-500"
              >
                {item.title}
              </span>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            {traceItems.map((item) =>
              item.interactive ?? Boolean(item.drawerSections?.length) ? (
                <button
                  key={item.id}
                  type="button"
                  className="flex w-full items-start justify-between gap-3 rounded-2xl border border-stone-200/90 bg-white/95 px-3 py-2.5 text-left transition hover:border-stone-300 hover:bg-stone-50"
                  onClick={() => setSelectedItem(item)}
                >
                  <TraceItemContent item={item} />
                </button>
              ) : (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-3 rounded-2xl border border-stone-200/90 bg-white/95 px-3 py-2.5"
                >
                  <TraceItemContent item={item} />
                </div>
              ),
            )}
          </div>
        </div>
      </details>

      {selectedItem && isMounted
        ? createPortal(
            <>
              <button
                type="button"
                aria-label="Close drawer"
                className="fixed inset-0 z-30 bg-stone-900/20 backdrop-blur-[1px]"
                onClick={() => setSelectedItem(null)}
              />
              <aside
                data-testid="activity-trace-drawer"
                className="fixed inset-y-0 right-0 z-40 flex h-screen w-[min(720px,100vw)] flex-col border-l border-border bg-white/95 shadow-2xl backdrop-blur"
              >
                <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                  <div>
                    <h2 className="text-xl font-semibold text-slate-900">
                      {selectedItem.drawerTitle ?? selectedItem.title}
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {selectedItem.drawerSubtitle ?? ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="rounded-full"
                    aria-label="Close drawer"
                    onClick={() => setSelectedItem(null)}
                  >
                    x
                  </Button>
                </div>
                <div className="overflow-auto px-5 py-4">
                  <div className="mb-4 flex flex-wrap gap-2">
                    <Badge variant="outline">trace inspection</Badge>
                    <Badge variant="outline" className="capitalize">
                      {selectedItem.badgeLabel}
                    </Badge>
                  </div>
                  <div className="space-y-5">
                    {(selectedItem.drawerSections ?? []).map((section) => (
                      <section key={`${selectedItem.id}:${section.title}`}>
                        <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-slate-500">
                          {section.title}
                        </h3>
                        <div className="rounded-2xl border border-border bg-white p-4 text-sm leading-7 text-slate-700 whitespace-pre-wrap break-words">
                          {section.body}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              </aside>
            </>,
            document.body,
          )
        : null}
    </>
  );
}

function TraceItemContent({ item }: { item: DisplayTraceItem }) {
  return (
    <>
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-2">
          <span
            className={cn(
              "inline-flex h-5 w-5 flex-none items-center justify-center rounded-full border border-stone-200 bg-stone-50 text-[10px] font-semibold text-stone-500",
              item.kind.includes("error") && "border-rose-200 bg-rose-50 text-rose-500",
            )}
          >
            {TRACE_ICONS[item.kind]}
          </span>
          <p className="text-sm font-semibold tracking-[-0.02em] text-stone-800">{item.title}</p>
        </div>
        <p className="text-xs leading-5 text-stone-500 whitespace-pre-wrap break-words">
          {item.summary}
        </p>
      </div>
    </>
  );
}
