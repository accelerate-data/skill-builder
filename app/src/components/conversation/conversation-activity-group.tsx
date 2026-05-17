import { useEffect, useState } from "react";
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
  tool_error: "!",
  subagent_error: "!",
};

export function ConversationActivityGroup({
  node,
}: ConversationActivityGroupProps) {
  const [selectedItem, setSelectedItem] = useState<DisplayTraceItem | null>(null);
  const traceItems = node.traceItems ?? [];

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

  return (
    <>
      <details
        data-testid="conversation-event-row"
        className="mr-auto w-full max-w-[92%] overflow-hidden rounded-2xl border border-border bg-stone-50/90 shadow-sm"
        open={!node.collapsedByDefault}
      >
        <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-4 py-3 hover:bg-stone-100/70">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800">{node.label ?? "Activity trace"}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {traceItems.length} trace item{traceItems.length === 1 ? "" : "s"} available in the shared activity timeline.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant="outline" className="bg-white/90">
              collapsed details
            </Badge>
            <Badge variant="outline" className="bg-white/90">
              inline tool activity
            </Badge>
          </div>
        </summary>
        <div className="border-t border-border bg-white/70 px-3 py-3">
          <div className="flex flex-col gap-2">
            {traceItems.map((item) =>
              item.interactive ?? Boolean(item.drawerSections?.length) ? (
                <button
                  key={item.id}
                  type="button"
                  className="flex w-full items-start justify-between gap-3 rounded-xl border border-stone-200 bg-white px-3 py-3 text-left transition hover:border-slate-300 hover:bg-stone-50"
                  onClick={() => setSelectedItem(item)}
                >
                  <TraceItemContent item={item} />
                </button>
              ) : (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-stone-200 bg-white px-3 py-3"
                >
                  <TraceItemContent item={item} />
                </div>
              ),
            )}
          </div>
        </div>
      </details>

      {selectedItem ? (
        <>
          <button
            type="button"
            aria-label="Close drawer"
            className="fixed inset-0 z-30 bg-stone-900/20 backdrop-blur-[1px]"
            onClick={() => setSelectedItem(null)}
          />
          <aside
            data-testid="activity-trace-drawer"
            className="fixed right-0 top-0 z-40 flex h-screen w-[560px] max-w-[calc(100vw-24px)] flex-col border-l border-border bg-white/95 shadow-2xl backdrop-blur"
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
        </>
      ) : null}
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
              "inline-flex h-5 w-5 flex-none items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-[10px] font-semibold text-slate-500",
              item.kind.includes("error") && "border-rose-200 bg-rose-50 text-rose-500",
            )}
          >
            {TRACE_ICONS[item.kind]}
          </span>
          <p className="text-sm font-semibold text-slate-800">{item.title}</p>
        </div>
        <p className="text-xs leading-5 text-slate-500 whitespace-pre-wrap break-words">
          {item.summary}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant="outline" className="capitalize">
          {item.badgeLabel}
        </Badge>
      </div>
    </>
  );
}
