import { memo } from "react";
import { Brain } from "lucide-react";
import { MemoizedMarkdown } from "./memoized-markdown";
import { ErrorBoundary } from "@/components/error-boundary";
import { BaseItem } from "./base-item";
import type { DisplayItem } from "@/lib/display-types";

export const ThinkingItem = memo(function ThinkingItem({ item }: { item: DisplayItem }) {
  const text = item.thinkingText ?? "";
  const summary = text.length > 60 ? text.slice(0, 60) + "..." : (text || "Extended thinking...");

  return (
    <BaseItem
      icon={<Brain className="size-3.5" />}
      label="Thinking"
      summary={summary}
      tokenCount={item.tokenCount}
      borderColor="var(--chat-thinking-border)"
      headerBg="var(--chat-thinking-bg)"
      defaultExpanded={false}
    >
      <ErrorBoundary fallback={<pre className="whitespace-pre-wrap break-words text-xs">{text}</pre>}>
        <MemoizedMarkdown content={text} />
      </ErrorBoundary>
    </BaseItem>
  );
});
