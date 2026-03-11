import { Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BaseItem } from "./base-item";
import type { DisplayItem } from "@/lib/display-types";

// Forward declaration — avoid circular import by using lazy DisplayItemList
import { DisplayItemList } from "./display-item-list";

const MAX_NESTING_DEPTH = 3;

export function SubagentItem({ item, depth = 0 }: { item: DisplayItem; depth?: number }) {
  const description = item.subagentDescription ?? "Sub-agent";
  const subagentType = item.subagentType;
  const childItems = item.subagentItems ?? [];

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{
        borderColor: "color-mix(in oklch, var(--chat-subagent-border), transparent 80%)",
        backgroundColor: "var(--chat-subagent-bg)",
      }}
    >
      <BaseItem
        icon={<Bot className="size-3.5" />}
        label={subagentType ? "" : "Sub-agent"}
        summary={
          subagentType ? (
            undefined
          ) : (
            description
          )
        }
        tokenCount={item.subagentMetrics?.outputTokens}
        status={item.subagentStatus}
        borderColor="var(--chat-subagent-border)"
        headerBg="var(--chat-subagent-bg)"
        defaultExpanded={false}
      >
        {childItems.length > 0 && depth < MAX_NESTING_DEPTH ? (
          <DisplayItemList items={childItems} depth={depth + 1} />
        ) : childItems.length > 0 ? (
          <div className="text-xs text-muted-foreground italic">
            {childItems.length} nested items (max depth reached)
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic">
            {item.subagentStatus === "running" ? "Running..." : "No output captured"}
          </div>
        )}
      </BaseItem>
      {subagentType && (
        <div className="flex items-center gap-1.5 px-2 pb-1">
          <Badge variant="outline" className="text-[10px] font-mono">
            {subagentType}
          </Badge>
          <span className="text-xs text-muted-foreground truncate">
            {description}
          </span>
        </div>
      )}
    </div>
  );
}
