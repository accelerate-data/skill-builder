import { memo } from "react";
import { MemoizedMarkdown } from "./memoized-markdown";
import { ErrorBoundary } from "@/components/error-boundary";
import type { DisplayItem } from "@/lib/display-types";

/**
 * Renders output text as bare markdown without the BaseItem wrapper.
 * Used by the grouped display to make agent prose prominent.
 */
export const BareOutput = memo(function BareOutput({ item }: { item: DisplayItem }) {
  const text = item.outputText ?? "";
  if (text.length === 0) return null;

  return (
    <div className="px-2 py-1">
      <ErrorBoundary fallback={<pre className="whitespace-pre-wrap break-words text-sm">{text}</pre>}>
        <MemoizedMarkdown content={text} />
      </ErrorBoundary>
    </div>
  );
});
