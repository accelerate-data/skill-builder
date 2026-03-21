import { memo } from "react";
import { Bot } from "lucide-react";
import { BaseItem } from "./base-item";
import { MemoizedMarkdown } from "./memoized-markdown";
import { ErrorBoundary } from "@/components/error-boundary";
import type { DisplayItem } from "@/lib/display-types";

// Forward declaration — avoid circular import by using lazy DisplayItemList
import { DisplayItemList } from "./display-item-list";

const MAX_NESTING_DEPTH = 3;

export const SubagentItem = memo(function SubagentItem({ item, depth = 0 }: { item: DisplayItem; depth?: number }) {
  const description = item.subagentDescription ?? "Sub-agent";
  const subagentType = item.subagentType;
  const childItems = item.subagentItems ?? [];
  const lastToolName = item.lastToolName;
  const conclusion = item.subagentConclusion?.trim();

  return (
    <BaseItem
      icon={<Bot className="size-3.5" />}
      label={subagentType ?? "Sub-agent"}
      summary={description}
      tokenCount={item.subagentMetrics?.outputTokens}
      status={item.subagentStatus}
      borderColor="var(--chat-subagent-border)"
      headerBg="var(--chat-subagent-bg)"
      defaultExpanded={false}
    >
      {conclusion || childItems.length > 0 ? (
        <div className="flex flex-col gap-2">
          {conclusion && (
            <BaseItem
              icon={<Bot className="size-3.5" />}
              label="Conclusion"
              summary={conclusion}
              borderColor="var(--chat-subagent-border)"
              headerBg="var(--chat-subagent-bg)"
              defaultExpanded={true}
            >
              <ErrorBoundary fallback={<pre className="whitespace-pre-wrap break-words text-sm">{conclusion}</pre>}>
                <MemoizedMarkdown content={conclusion} />
              </ErrorBoundary>
            </BaseItem>
          )}
          {childItems.length > 0 && depth < MAX_NESTING_DEPTH ? (
            <DisplayItemList items={childItems} depth={depth + 1} />
          ) : childItems.length > 0 ? (
            <div className="text-xs text-muted-foreground italic">
              {childItems.length} nested items (max depth reached)
            </div>
          ) : null}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground italic">
          {item.subagentStatus === "running"
            ? (lastToolName ? `Running: ${lastToolName}` : "Running...")
            : "No output captured"}
        </div>
      )}
    </BaseItem>
  );
});
