import { memo, useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import { MemoizedMarkdown } from "./memoized-markdown";
import { ErrorBoundary } from "@/components/error-boundary";
import type { DisplayItem } from "@/lib/display-types";

/**
 * Renders output text as bare markdown without the BaseItem wrapper.
 * Used by the grouped display to make agent prose prominent.
 */
export const BareOutput = memo(function BareOutput({ item }: { item: DisplayItem }) {
  const text = item.outputText ?? "";
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      console.warn("[bare-output] Clipboard write failed");
    });
  }, [text]);

  if (text.length === 0) return null;

  return (
    <div className="group/output relative px-2 py-1">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 opacity-0 group-hover/output:opacity-100 transition-opacity p-1 rounded hover:bg-muted text-muted-foreground"
        aria-label="Copy as markdown"
        title={copied ? "Copied!" : "Copy as markdown"}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      <ErrorBoundary fallback={<pre className="whitespace-pre-wrap break-words text-sm">{text}</pre>}>
        <MemoizedMarkdown content={text} />
      </ErrorBoundary>
    </div>
  );
});
