import { memo } from "react";
import type { DisplayItem } from "@/lib/display-types";
import { ThinkingItem } from "./thinking-item";
import { OutputItem } from "./output-item";
import { ToolItem } from "./tool-item";
import { SubagentItem } from "./subagent-item";
import { ResultItem } from "./result-item";
import { ErrorItem } from "./error-item";

function DisplayItemRenderer({ item, depth = 0 }: { item: DisplayItem; depth?: number }) {
  switch (item.type) {
    case "thinking":
      return <ThinkingItem item={item} />;
    case "output":
      return <OutputItem item={item} />;
    case "tool_call":
      return <ToolItem item={item} />;
    case "subagent":
      return <SubagentItem item={item} depth={depth} />;
    case "result":
      return <ResultItem item={item} />;
    case "error":
      return <ErrorItem item={item} />;
    case "compact_boundary":
      return (
        <div className="flex items-center gap-2 py-1">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
            Context compacted
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
      );
    default:
      return null;
  }
}

interface DisplayItemListProps {
  items: DisplayItem[];
  depth?: number;
}

export const DisplayItemList = memo(function DisplayItemList({
  items,
  depth = 0,
}: DisplayItemListProps) {
  if (items.length === 0) return null;

  return (
    <div className="flex min-w-0 w-full flex-col gap-0.5 overflow-hidden">
      {items.map((item) => (
        <div key={item.id} className="min-w-0 w-full animate-message-in">
          <DisplayItemRenderer item={item} depth={depth} />
        </div>
      ))}
    </div>
  );
});
