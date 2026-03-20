import { memo, useMemo } from "react";
import type { DisplayItem } from "@/lib/display-types";
import { groupDisplayItems, type VisualGroup } from "@/lib/group-display-items";
import { ThinkingItem } from "./thinking-item";
import { OutputItem } from "./output-item";
import { ToolItem } from "./tool-item";
import { SubagentItem } from "./subagent-item";
import { ResultItem } from "./result-item";
import { ErrorItem } from "./error-item";
import { BareOutput } from "./bare-output";
import { ToolActivityGroupView } from "./tool-activity-group";

const PassthroughRenderer = memo(function PassthroughRenderer({
  item,
  depth = 0,
}: {
  item: DisplayItem;
  depth?: number;
}) {
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
});

const VisualGroupRenderer = memo(function VisualGroupRenderer({
  group,
  depth = 0,
}: {
  group: VisualGroup;
  depth?: number;
}) {
  switch (group.type) {
    case "bare-output":
      return <BareOutput item={group.item} />;
    case "tool-activity":
      return <ToolActivityGroupView items={group.items} />;
    case "passthrough":
      return <PassthroughRenderer item={group.item} depth={depth} />;
    default:
      return null;
  }
});

interface DisplayItemListProps {
  items: DisplayItem[];
  depth?: number;
}

export const DisplayItemList = memo(function DisplayItemList({
  items,
  depth = 0,
}: DisplayItemListProps) {
  const groups = useMemo(() => groupDisplayItems(items), [items]);

  if (groups.length === 0) return null;

  return (
    <div className="flex min-w-0 w-full flex-col gap-0.5 overflow-hidden">
      {groups.map((group) => (
        <div key={group.key} className="min-w-0 w-full animate-message-in">
          <VisualGroupRenderer group={group} depth={depth} />
        </div>
      ))}
    </div>
  );
});
