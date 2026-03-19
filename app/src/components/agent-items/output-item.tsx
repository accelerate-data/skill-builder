import { memo } from "react";
import { MessageSquare } from "lucide-react";
import { MemoizedMarkdown } from "./memoized-markdown";
import { ErrorBoundary } from "@/components/error-boundary";
import { BaseItem } from "./base-item";
import type { DisplayItem } from "@/lib/display-types";

export const OutputItem = memo(function OutputItem({ item }: { item: DisplayItem }) {
  const text = item.outputText ?? "";
  if (text.length === 0) return null;
  const summary = text.length > 60 ? text.slice(0, 60) + "..." : text;

  return (
    <BaseItem
      icon={<MessageSquare className="size-3.5" />}
      label="Output"
      summary={summary}
      tokenCount={item.tokenCount}
      borderColor="var(--color-pacific)"
      defaultExpanded={true}
    >
      <ErrorBoundary fallback={<pre className="whitespace-pre-wrap break-words text-sm">{text}</pre>}>
        <MemoizedMarkdown content={text} />
      </ErrorBoundary>
    </BaseItem>
  );
});
