import { memo } from "react";
import { XCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { MemoizedMarkdown } from "./memoized-markdown";
import { ErrorBoundary } from "@/components/error-boundary";
import type { DisplayItem } from "@/lib/display-types";

export const ResultItem = memo(function ResultItem({ item }: { item: DisplayItem }) {
  const status = item.resultStatus ?? "success";
  const text = item.outputText_result ?? "Agent completed";

  if (status === "error") {
    return (
      <div className="border-l-2 border-l-[var(--chat-error-border)] bg-[var(--chat-error-bg)] rounded-md px-3 py-1 flex items-start gap-2 text-sm text-destructive">
        <AlertTriangle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
        <span>{text}</span>
      </div>
    );
  }

  if (status === "refusal") {
    return (
      <div className="border-l-2 border-l-[var(--chat-error-border)] bg-[var(--chat-error-bg)] rounded-md px-3 py-1 flex items-start gap-2 text-sm text-destructive">
        <XCircle className="size-4 shrink-0 mt-0.5" aria-hidden="true" />
        <span>Agent declined this request due to safety constraints. Please revise your prompt.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground/60 py-1">
        <CheckCircle2 className="size-3 shrink-0" aria-hidden="true" style={{ color: "var(--color-seafoam)" }} />
        <span>{text}</span>
      </div>
      {item.resultMarkdown && (
        <ErrorBoundary fallback={<pre className="whitespace-pre-wrap break-words text-sm">{item.resultMarkdown}</pre>}>
          <MemoizedMarkdown content={item.resultMarkdown} />
        </ErrorBoundary>
      )}
    </div>
  );
});
