import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { DisplayNode, DisplayTraceItem } from "@/lib/display-types";
import { MemoizedMarkdown } from "@/components/agent-items/memoized-markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ConversationActivityGroupProps {
  node: DisplayNode;
}

function formatTraceTimestamp(createdAtMs: number): string {
  return new Date(createdAtMs).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
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

  return (
    <>
      <details
        data-testid="conversation-event-row"
        className="mr-auto w-full max-w-[56%] overflow-hidden rounded-[22px] border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.92))] shadow-[0_12px_24px_-24px_rgba(28,25,23,0.18)] dark:bg-[linear-gradient(180deg,rgba(39,39,42,0.96),rgba(24,24,27,0.96))] dark:shadow-[0_20px_40px_-32px_rgba(0,0,0,0.5)]"
        open={!node.collapsedByDefault}
      >
        <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-3.5 py-2.5 hover:bg-accent/60">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-[0.92rem] font-semibold tracking-[-0.02em] text-foreground">
                {node.label ?? "Activity trace"}
              </p>
              <span className="rounded-full border border-border bg-background/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {traceItems.length} item{traceItems.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          <span className="mt-0.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Open
          </span>
        </summary>
        <div className="border-t border-border bg-background/55 px-2.5 py-2.5 dark:bg-background/20">
          <div className="flex flex-col gap-1.5">
            {traceItems.map((item) =>
              item.interactive ?? Boolean(item.drawerSections?.length) ? (
                <button
                  key={item.id}
                  type="button"
                  className="flex w-full items-start justify-between gap-3 rounded-2xl border border-border bg-card/90 px-3 py-2.5 text-left transition hover:border-border hover:bg-accent/55 dark:bg-card/70 dark:hover:bg-accent/45"
                  onClick={() => setSelectedItem(item)}
                >
                  <TraceItemContent item={item} />
                </button>
              ) : (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-3 rounded-2xl border border-border bg-card/90 px-3 py-2.5 dark:bg-card/70"
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
                className="fixed inset-0 z-30 bg-black/35 backdrop-blur-[2px] dark:bg-black/55"
                onClick={() => setSelectedItem(null)}
              />
              <aside
                data-testid="activity-trace-drawer"
                className="fixed inset-y-0 right-0 z-40 flex h-screen w-[min(720px,100vw)] flex-col border-l border-border bg-background/95 shadow-2xl backdrop-blur"
              >
                <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">
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
                    <Badge variant="outline" className="bg-muted/40 text-muted-foreground">trace inspection</Badge>
                    <Badge variant="outline" className="capitalize">
                      {selectedItem.badgeLabel}
                    </Badge>
                  </div>
                  <div className="space-y-5">
                    {(selectedItem.drawerSections ?? []).map((section) => (
                      <section key={`${selectedItem.id}:${section.title}`}>
                        <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">
                          {section.title}
                        </h3>
                        {selectedItem.kind === "skill" ? (
                          <div className="rounded-2xl border border-border bg-card/90 p-4 text-sm text-foreground/90 break-words">
                            <MemoizedMarkdown
                              content={section.body}
                              className="markdown-body compact max-w-none text-sm leading-7 text-foreground/90 [&_*]:break-words"
                            />
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-border bg-card/90 p-4 text-sm leading-7 text-foreground/90 whitespace-pre-wrap break-words">
                            {section.body}
                          </div>
                        )}
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
  const timestamp = formatTraceTimestamp(item.createdAtMs);

  return (
    <>
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <p className="text-sm font-semibold tracking-[-0.02em] text-foreground">{item.title}</p>
          <p className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
            {timestamp}
          </p>
        </div>
        <p className="text-xs leading-5 text-muted-foreground whitespace-pre-wrap break-words">
          {item.summary}
        </p>
      </div>
    </>
  );
}
